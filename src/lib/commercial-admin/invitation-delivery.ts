export type InvitationDeliveryStatus = "queued" | "processing" | "accepted_by_provider" | "retrying" | "permanently_failed" | "not_queued";

export function invitationDeliveryMessage(status: InvitationDeliveryStatus): { text: string; tone: "neutral" | "warning" | "error" } {
  if (status === "accepted_by_provider") return { text: "Email accepted for delivery", tone: "neutral" };
  if (status === "retrying") return { text: "Invitation created. Email delivery will retry.", tone: "warning" };
  if (status === "permanently_failed") return { text: "Invitation created, but email delivery failed. Use resend to create a fresh delivery.", tone: "error" };
  if (status === "processing") return { text: "Email delivery in progress", tone: "neutral" };
  if (status === "queued") return { text: "Email queued", tone: "neutral" };
  return { text: "Invitation created. Email is not queued.", tone: "warning" };
}
