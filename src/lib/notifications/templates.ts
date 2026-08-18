import type { NotificationMessageType, NotificationTemplateVersion } from "./contracts";

type InvitationInput = {
  messageType: "manager_invitation" | "staff_invitation";
  templateVersion: "manager_invitation_v1" | "staff_invitation_v1";
  acceptanceUrl: string;
};

type NoticeInput = {
  messageType: "trial_ending" | "payment_failure";
  templateVersion: "trial_ending_v1" | "payment_failure_v1";
  accountUrl: string;
};

export type NotificationTemplateInput = InvitationInput | NoticeInput;

export type RenderedNotification = {
  subject: string;
  html: string;
  text: string;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}
export function renderNotification(input: NotificationTemplateInput): RenderedNotification {
  const configurations: Record<NotificationMessageType, { version: NotificationTemplateVersion; subject: string; intro: string; action: string }> = {
    manager_invitation: { version: "manager_invitation_v1", subject: "You have been invited to Workforce Platform", intro: "You have been invited to help manage an organisation in Workforce Platform.", action: "Accept manager invitation" },
    staff_invitation: { version: "staff_invitation_v1", subject: "You have been invited to Workforce Platform", intro: "You have been invited to access your organisation in Workforce Platform.", action: "Accept staff invitation" },
    trial_ending: { version: "trial_ending_v1", subject: "Your trial is ending soon", intro: "Your organisation's trial is ending soon. Core records remain protected.", action: "Review plan and billing" },
    payment_failure: { version: "payment_failure_v1", subject: "Action is needed for your subscription", intro: "We could not confirm the latest subscription payment. Existing records remain available.", action: "Review billing" },
  };
  const configuration = configurations[input.messageType];
  if (configuration.version !== input.templateVersion) throw new Error("Unsupported notification template version.");
  const url = "acceptanceUrl" in input ? input.acceptanceUrl : input.accountUrl;
  const safeUrl = escapeHtml(url);
  const text = `${configuration.intro}\n\n${configuration.action}: ${url}\n\nIf you were not expecting this message, you can ignore it.`;
  const html = `<p>${escapeHtml(configuration.intro)}</p><p><a href="${safeUrl}">${escapeHtml(configuration.action)}</a></p><p>If you were not expecting this message, you can ignore it.</p>`;
  return { subject: configuration.subject, html, text };
}
