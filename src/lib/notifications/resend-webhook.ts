import { createHmac, timingSafeEqual } from "node:crypto";

type WebhookHeaders = { id: string | null; timestamp: string | null; signature: string | null };
type ProviderEventType = "delivered" | "bounced" | "complained" | "suppressed";

export type MappedProviderEvent = {
  providerEventReference: string;
  providerMessageReference: string;
  eventType: ProviderEventType;
  eventOccurredAt: string;
  failureCode: string | null;
};

export type ResendWebhookOutcome = { outcome: "ignored" } | { outcome: "record"; event: MappedProviderEvent };

export class ResendWebhookError extends Error {
  constructor(message = "Invalid Resend webhook request.") {
    super(message);
    this.name = "ResendWebhookError";
  }
}

function signingKey(secret: string): Buffer {
  if (!secret.startsWith("whsec_")) throw new ResendWebhookError();
  const key = Buffer.from(secret.slice(6), "base64");
  if (key.length < 16) throw new ResendWebhookError();
  return key;
}

function signatureIsValid(rawBody: string, headers: WebhookHeaders, secret: string, nowSeconds: number): boolean {
  if (!headers.id || !headers.timestamp || !headers.signature) return false;
  if (!Number.isInteger(Number(headers.timestamp)) || Math.abs(nowSeconds - Number(headers.timestamp)) > 300) return false;
  const expected = createHmac("sha256", signingKey(secret))
    .update(`${headers.id}.${headers.timestamp}.${rawBody}`)
    .digest();
  return headers.signature.split(" ").some((entry) => {
    if (!entry.startsWith("v1,")) return false;
    const supplied = Buffer.from(entry.slice(3), "base64");
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  });
}

function boundedReference(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 1 || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  return value;
}

function failureCode(type: ProviderEventType, payload: Record<string, unknown>): string | null {
  if (type === "delivered") return null;
  if (type === "bounced") {
    const bounce = payload.bounce;
    const bounceType = bounce && typeof bounce === "object" ? (bounce as Record<string, unknown>).type : null;
    if (typeof bounceType === "string" && /^[a-z0-9_.:-]{1,48}$/i.test(bounceType)) {
      return `resend.bounce.${bounceType.toLowerCase()}`;
    }
    return "resend.bounced";
  }
  return `resend.${type}`;
}

export function verifyAndMapResendWebhook(input: {
  rawBody: string;
  headers: WebhookHeaders;
  secret: string;
  nowSeconds?: number;
}): ResendWebhookOutcome {
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!signatureIsValid(input.rawBody, input.headers, input.secret, nowSeconds)) throw new ResendWebhookError();

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(input.rawBody) as Record<string, unknown>;
  } catch {
    throw new ResendWebhookError("The webhook did not contain a valid provider event.");
  }
  const mappings: Record<string, ProviderEventType> = {
    "email.delivered": "delivered",
    "email.bounced": "bounced",
    "email.complained": "complained",
    "email.suppressed": "suppressed",
  };
  const eventType = typeof payload.type === "string" ? mappings[payload.type] : undefined;
  if (!eventType) return { outcome: "ignored" };
  const data = payload.data && typeof payload.data === "object" ? payload.data as Record<string, unknown> : {};
  const providerEventReference = boundedReference(input.headers.id);
  const providerMessageReference = boundedReference(data.email_id);
  const eventOccurredAt = typeof payload.created_at === "string" ? payload.created_at : "";
  if (!providerEventReference || !providerMessageReference || !Number.isFinite(Date.parse(eventOccurredAt))) {
    throw new ResendWebhookError("The webhook did not contain a valid provider event.");
  }
  return {
    outcome: "record",
    event: {
      providerEventReference,
      providerMessageReference,
      eventType,
      eventOccurredAt,
      failureCode: failureCode(eventType, data),
    },
  };
}
