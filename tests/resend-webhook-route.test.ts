import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/auth/supabase-admin", () => ({ createSupabaseAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/config/environment", () => ({ validateEnvironment: () => ({ appEnvironment: "staging" }) }));

import { POST } from "@/app/api/webhooks/resend/route";

const originalEnvironment = { ...process.env };
const signingKey = Buffer.from("fictional-route-signing-key");
const webhookSecret = `whsec_${signingKey.toString("base64")}`;

function webhookRequest(rawBody: string, signed = true) {
  const id = "evt_route_123";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", signingKey).update(`${id}.${timestamp}.${rawBody}`).digest("base64");
  return new Request("https://staging.example.test/api/webhooks/resend", {
    method: "POST",
    headers: signed ? { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": `v1,${signature}` } : {},
    body: rawBody,
  });
}

afterEach(() => {
  process.env = { ...originalEnvironment };
  mocks.rpc.mockReset();
});

describe("Resend webhook route", () => {
  it("fails closed when the signing secret is unavailable", async () => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    expect((await POST(webhookRequest("{}", false))).status).toBe(404);
  });

  it("rejects an unsigned request without touching the database", async () => {
    process.env.RESEND_WEBHOOK_SECRET = webhookSecret;
    expect((await POST(webhookRequest("{}", false))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("records a verified event through the existing service-role RPC", async () => {
    process.env.RESEND_WEBHOOK_SECRET = webhookSecret;
    mocks.rpc.mockResolvedValue({ data: { outcome: "recorded" }, error: null });
    const rawBody = JSON.stringify({
      type: "email.delivered",
      created_at: "2027-01-15T10:00:00.000Z",
      data: { email_id: "email_route_123" },
    });
    const response = await POST(webhookRequest(rawBody));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("record_notification_provider_event", {
      target_provider_event_reference: "evt_route_123",
      target_provider_message_reference: "email_route_123",
      target_event_type: "delivered",
      target_event_occurred_at: "2027-01-15T10:00:00.000Z",
      target_failure_code: null,
    });
  });

  it("returns a retryable failure when authoritative persistence is unavailable", async () => {
    process.env.RESEND_WEBHOOK_SECRET = webhookSecret;
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "private database detail" } });
    const rawBody = JSON.stringify({
      type: "email.bounced",
      created_at: "2027-01-15T10:00:00.000Z",
      data: { email_id: "email_route_124", bounce: { type: "permanent" } },
    });
    expect((await POST(webhookRequest(rawBody))).status).toBe(503);
  });
});
