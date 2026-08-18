import type { DeliveryResult, TransactionalEmailMessage, TransactionalEmailProvider } from "./contracts";

type ResendDependencies = {
  apiKey: string;
  request?: typeof fetch;
};

function failureForStatus(status: number): DeliveryResult {
  if (status === 408 || status === 409 || status === 429 || status >= 500) {
    return { outcome: "retryable_failure", code: status === 429 ? "provider_rate_limited" : "provider_unavailable" };
  }
  return { outcome: "permanent_failure", code: "provider_rejected" };
}

export function createResendEmailProvider(dependencies: ResendDependencies): TransactionalEmailProvider {
  const request = dependencies.request ?? fetch;
  return {
    async send(message: TransactionalEmailMessage): Promise<DeliveryResult> {
      let response: Response;
      try {
        response = await request("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${dependencies.apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `notification/${message.messageId}/${message.templateVersion}`,
          },
          body: JSON.stringify({
            from: message.fromAddress,
            to: [message.recipientAddress],
            subject: message.subject,
            html: message.html,
            text: message.text,
            tags: message.tags,
          }),
        });
      } catch {
        return { outcome: "retryable_failure", code: "provider_unavailable" };
      }
      if (!response.ok) return failureForStatus(response.status);
      const value = await response.json().catch(() => null) as { id?: unknown } | null;
      if (!value || typeof value.id !== "string" || value.id.length < 1 || value.id.length > 200) {
        return { outcome: "retryable_failure", code: "provider_response_invalid" };
      }
      return { outcome: "accepted", providerReference: value.id };
    },
  };
}
