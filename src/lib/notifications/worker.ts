import type { NotificationMessageType, NotificationTemplateVersion, TransactionalEmailProvider } from "./contracts";
import { resolveNotificationRecipient } from "./config";
import { renderNotification } from "./templates";

type ClaimedNotification =
  | { outcome: "not_available" }
  | {
      outcome: "claimed";
      outboxId: string;
      messageType: NotificationMessageType;
      templateVersion: NotificationTemplateVersion;
      recipientAddress: string;
      invitationToken?: string;
    };

type DeliveryRecord = {
  outboxId: string;
  outcome: "accepted" | "retryable_failure" | "permanent_failure";
  providerReference: string | null;
  code: string | null;
};

export type NotificationWorkerDependencies = {
  claimNext(): Promise<ClaimedNotification>;
  record(input: DeliveryRecord): Promise<unknown>;
  provider: TransactionalEmailProvider;
  appEnvironment: string;
  siteUrl: string;
  fromAddress: string;
  stagingRecipient: string;
};

export type NotificationBatchResult = {
  claimed: number;
  accepted: number;
  retryableFailures: number;
  permanentFailures: number;
};

function invitationPath(messageType: NotificationMessageType): "manager" | "staff" | null {
  if (messageType === "manager_invitation") return "manager";
  if (messageType === "staff_invitation") return "staff";
  return null;
}

function templateMatches(messageType: NotificationMessageType, templateVersion: NotificationTemplateVersion): boolean {
  return templateVersion === `${messageType}_v1`;
}

export async function processNotificationBatch(
  dependencies: NotificationWorkerDependencies,
  requestedLimit: number,
): Promise<NotificationBatchResult> {
  const result: NotificationBatchResult = { claimed: 0, accepted: 0, retryableFailures: 0, permanentFailures: 0 };
  const limit = Math.max(1, Math.min(25, Math.trunc(requestedLimit)));
  for (let index = 0; index < limit; index += 1) {
    const claim = await dependencies.claimNext();
    if (claim.outcome === "not_available") break;
    result.claimed += 1;
    if (!templateMatches(claim.messageType, claim.templateVersion)) {
      result.permanentFailures += 1;
      await dependencies.record({ outboxId: claim.outboxId, outcome: "permanent_failure", providerReference: null, code: "template_invalid" });
      continue;
    }

    const kind = invitationPath(claim.messageType);
    if (kind && !claim.invitationToken) {
      result.permanentFailures += 1;
      await dependencies.record({ outboxId: claim.outboxId, outcome: "permanent_failure", providerReference: null, code: "delivery_material_missing" });
      continue;
    }

    const baseUrl = dependencies.siteUrl.replace(/\/$/, "");
    const rendered = kind
      ? renderNotification({
          messageType: claim.messageType as "manager_invitation" | "staff_invitation",
          templateVersion: claim.templateVersion as "manager_invitation_v1" | "staff_invitation_v1",
          acceptanceUrl: `${baseUrl}/invitations/${kind}?token=${encodeURIComponent(claim.invitationToken!)}`,
        })
      : renderNotification({
          messageType: claim.messageType as "trial_ending" | "payment_failure",
          templateVersion: claim.templateVersion as "trial_ending_v1" | "payment_failure_v1",
          accountUrl: `${baseUrl}/admin/billing`,
        });
    const delivery = await dependencies.provider.send({
      messageId: claim.outboxId,
      messageType: claim.messageType,
      templateVersion: claim.templateVersion,
      recipientAddress: resolveNotificationRecipient({
        appEnvironment: dependencies.appEnvironment,
        intendedRecipient: claim.recipientAddress,
        stagingRecipient: dependencies.stagingRecipient,
      }),
      fromAddress: dependencies.fromAddress,
      ...rendered,
      tags: [{ name: "environment", value: "staging" }, { name: "message_type", value: claim.messageType }],
    });
    if (delivery.outcome === "accepted") {
      result.accepted += 1;
      await dependencies.record({ outboxId: claim.outboxId, outcome: "accepted", providerReference: delivery.providerReference, code: null });
    } else {
      if (delivery.outcome === "retryable_failure") result.retryableFailures += 1;
      else result.permanentFailures += 1;
      await dependencies.record({ outboxId: claim.outboxId, outcome: delivery.outcome, providerReference: null, code: delivery.code });
    }
  }
  return result;
}
