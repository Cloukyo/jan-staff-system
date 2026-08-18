export type NotificationMessageType =
  | "manager_invitation"
  | "staff_invitation"
  | "trial_ending"
  | "payment_failure";

export type NotificationTemplateVersion =
  | "manager_invitation_v1"
  | "staff_invitation_v1"
  | "trial_ending_v1"
  | "payment_failure_v1";

export type TransactionalEmailMessage = {
  messageId: string;
  messageType: NotificationMessageType;
  templateVersion: NotificationTemplateVersion;
  recipientAddress: string;
  fromAddress: string;
  subject: string;
  html: string;
  text: string;
  tags: Array<{ name: string; value: string }>;
};

export type DeliveryResult =
  | { outcome: "accepted"; providerReference: string }
  | { outcome: "retryable_failure" | "permanent_failure"; code: string };

export interface TransactionalEmailProvider {
  send(message: TransactionalEmailMessage): Promise<DeliveryResult>;
}
