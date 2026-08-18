import { describe, expect, it, vi } from "vitest";
import { createResendEmailProvider } from "@/lib/notifications/resend-provider";
import { renderNotification } from "@/lib/notifications/templates";
import { resolveNotificationRecipient } from "@/lib/notifications/config";

describe("commercial notification delivery", () => {
  it("renders a neutral manager invitation without persisting a token or URL field", () => {
    const rendered = renderNotification({
      messageType: "manager_invitation",
      templateVersion: "manager_invitation_v1",
      acceptanceUrl: "https://staging.example.test/invitations/manager?token=secret",
    });

    expect(rendered.subject).toBe("You have been invited to Workforce Platform");
    expect(rendered.text).toContain("https://staging.example.test/invitations/manager?token=secret");
    expect(JSON.stringify(rendered)).not.toContain("invitationToken");
    expect(rendered.text.toLowerCase()).not.toMatch(/jan|nursery|preschool/);
  });

  it("fails closed to the configured Resend test recipient in staging", () => {
    expect(resolveNotificationRecipient({
      appEnvironment: "staging",
      intendedRecipient: "fictional.manager@example.test",
      stagingRecipient: "delivered+pilot@resend.dev",
    })).toBe("delivered+pilot@resend.dev");

    expect(() => resolveNotificationRecipient({
      appEnvironment: "staging",
      intendedRecipient: "fictional.manager@example.test",
      stagingRecipient: "person@example.com",
    })).toThrow("controlled Resend test recipient");
  });

  it("uses the durable message identity as the provider idempotency key", async () => {
    const request = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ id: "email_test_123" }), { status: 200 }));
    const provider = createResendEmailProvider({ apiKey: "test-key", request });

    const result = await provider.send({
      messageId: "00000000-0000-4000-8000-000000000123",
      messageType: "manager_invitation",
      templateVersion: "manager_invitation_v1",
      recipientAddress: "delivered+pilot@resend.dev",
      fromAddress: "Workforce Platform <staging@notifications.example.test>",
      subject: "You have been invited to Workforce Platform",
      html: "<p>Safe body</p>",
      text: "Safe body",
      tags: [{ name: "environment", value: "staging" }],
    });

    expect(result).toEqual({ outcome: "accepted", providerReference: "email_test_123" });
    const [, init] = request.mock.calls[0];
    expect(new Headers(init?.headers).get("Idempotency-Key")).toBe(
      "notification/00000000-0000-4000-8000-000000000123/manager_invitation_v1",
    );
  });

  it("maps provider rejection to bounded safe failures", async () => {
    const request = vi.fn<typeof fetch>(async () => new Response("provider detail must not escape", { status: 429 }));
    const provider = createResendEmailProvider({ apiKey: "test-key", request });
    const result = await provider.send({
      messageId: "00000000-0000-4000-8000-000000000124",
      messageType: "trial_ending",
      templateVersion: "trial_ending_v1",
      recipientAddress: "delivered+pilot@resend.dev",
      fromAddress: "Workforce Platform <staging@notifications.example.test>",
      subject: "Your trial is ending soon",
      html: "<p>Review billing</p>",
      text: "Review billing",
      tags: [],
    });

    expect(result).toEqual({ outcome: "retryable_failure", code: "provider_rate_limited" });
    expect(JSON.stringify(result)).not.toContain("provider detail");
  });
});
