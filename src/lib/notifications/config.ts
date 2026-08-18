type RecipientInput = {
  appEnvironment: string;
  intendedRecipient: string;
  stagingRecipient?: string;
};

export function resolveNotificationRecipient(input: RecipientInput): string {
  if (input.appEnvironment !== "staging") {
    throw new Error("Transactional delivery is enabled for Commercial Staging only.");
  }
  const recipient = input.stagingRecipient?.trim().toLowerCase();
  if (!recipient || !/^(delivered|bounced|complained)(\+[a-z0-9._-]+)?@resend\.dev$/.test(recipient)) {
    throw new Error("Commercial Staging requires a controlled Resend test recipient.");
  }
  return recipient;
}
