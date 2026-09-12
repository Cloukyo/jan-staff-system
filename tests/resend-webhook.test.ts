import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ResendWebhookError, verifyAndMapResendWebhook } from "@/lib/notifications/resend-webhook";

const signingKey = Buffer.from("fictional-resend-webhook-signing-key");
const secret = `whsec_${signingKey.toString("base64")}`;
const timestamp = 1_800_000_000;

function signedHeaders(rawBody: string, overrides: Partial<Record<string, string>> = {}) {
  const id = overrides.id ?? "evt_fictional_123";
  const signedAt = overrides.timestamp ?? String(timestamp);
  const signature = createHmac("sha256", signingKey).update(`${id}.${signedAt}.${rawBody}`).digest("base64");
  return { id, timestamp: signedAt, signature: overrides.signature ?? `v1,${signature}` };
}

function payload(type = "email.delivered") {
  return JSON.stringify({
    type,
    created_at: "2027-01-15T10:00:00.000Z",
    data: { email_id: "email_fictional_123", bounce: { type: "permanent" } },
  });
}

describe("Resend delivery webhook", () => {
  it.each([
    ["email.delivered", "delivered", null],
    ["email.bounced", "bounced", "resend.bounce.permanent"],
    ["email.complained", "complained", "resend.complained"],
    ["email.suppressed", "suppressed", "resend.suppressed"],
  ] as const)("maps %s to the existing delivery lifecycle", (type, eventType, failureCode) => {
    const rawBody = payload(type);
    expect(verifyAndMapResendWebhook({ rawBody, headers: signedHeaders(rawBody), secret, nowSeconds: timestamp })).toEqual({
      outcome: "record",
      event: {
        providerEventReference: "evt_fictional_123",
        providerMessageReference: "email_fictional_123",
        eventType,
        eventOccurredAt: "2027-01-15T10:00:00.000Z",
        failureCode,
      },
    });
  });

  it("acknowledges unsupported signed events without persisting engagement data", () => {
    const rawBody = payload("email.opened");
    expect(verifyAndMapResendWebhook({ rawBody, headers: signedHeaders(rawBody), secret, nowSeconds: timestamp }))
      .toEqual({ outcome: "ignored" });
  });

  it.each([{ signature: "v1,invalid" }, { timestamp: String(timestamp - 301) }])(
    "rejects invalid or stale signatures",
    (overrides) => {
      const rawBody = payload();
      expect(() => verifyAndMapResendWebhook({ rawBody, headers: signedHeaders(rawBody, overrides), secret, nowSeconds: timestamp }))
        .toThrow(ResendWebhookError);
    },
  );

  it("rejects malformed event data after signature verification", () => {
    const rawBody = JSON.stringify({ type: "email.delivered", created_at: "invalid", data: {} });
    expect(() => verifyAndMapResendWebhook({ rawBody, headers: signedHeaders(rawBody), secret, nowSeconds: timestamp }))
      .toThrow("valid provider event");
  });
});
