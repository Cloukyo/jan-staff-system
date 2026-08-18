import { describe, expect, it, vi } from "vitest";
import { processNotificationBatch, type NotificationWorkerDependencies } from "@/lib/notifications/worker";

function dependencies(overrides: Partial<NotificationWorkerDependencies> = {}): NotificationWorkerDependencies {
  return {
    claimNext: vi.fn()
      .mockResolvedValueOnce({
        outcome: "claimed",
        outboxId: "00000000-0000-4000-8000-000000000321",
        messageType: "manager_invitation",
        templateVersion: "manager_invitation_v1",
        recipientAddress: "fictional.manager@example.test",
        invitationToken: "a".repeat(64),
      })
      .mockResolvedValue({ outcome: "not_available" }),
    record: vi.fn().mockResolvedValue({ outcome: "recorded" }),
    provider: { send: vi.fn().mockResolvedValue({ outcome: "accepted", providerReference: "email_test_321" }) },
    appEnvironment: "staging",
    siteUrl: "https://sh-workforce-staging.vercel.app",
    fromAddress: "Workforce Platform <staging@notifications.example.test>",
    stagingRecipient: "delivered+pilot@resend.dev",
    ...overrides,
  };
}

describe("notification delivery worker", () => {
  it("renders the acceptance URL only in memory after a trusted claim", async () => {
    const deps = dependencies();
    const result = await processNotificationBatch(deps, 5);

    expect(result).toEqual({ claimed: 1, accepted: 1, retryableFailures: 0, permanentFailures: 0 });
    expect(deps.provider.send).toHaveBeenCalledWith(expect.objectContaining({
      recipientAddress: "delivered+pilot@resend.dev",
      text: expect.stringContaining("/invitations/manager?token="),
    }));
    expect(deps.record).toHaveBeenCalledWith({
      outboxId: "00000000-0000-4000-8000-000000000321",
      outcome: "accepted",
      providerReference: "email_test_321",
      code: null,
    });
    expect(JSON.stringify((deps.record as ReturnType<typeof vi.fn>).mock.calls)).not.toContain("token=");
  });

  it("records a bounded retry without exposing provider or token details", async () => {
    const deps = dependencies({
      provider: { send: vi.fn().mockResolvedValue({ outcome: "retryable_failure", code: "provider_unavailable" }) },
    });
    const result = await processNotificationBatch(deps, 1);

    expect(result.retryableFailures).toBe(1);
    expect(deps.record).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "retryable_failure",
      code: "provider_unavailable",
      providerReference: null,
    }));
    expect(JSON.stringify(result)).not.toContain("fictional.manager");
  });

  it("rejects claims whose template and message type do not match", async () => {
    const deps = dependencies({
      claimNext: vi.fn().mockResolvedValueOnce({
        outcome: "claimed",
        outboxId: "00000000-0000-4000-8000-000000000322",
        messageType: "manager_invitation",
        templateVersion: "staff_invitation_v1",
        recipientAddress: "fictional.manager@example.test",
        invitationToken: "b".repeat(64),
      }).mockResolvedValue({ outcome: "not_available" }),
    });
    const result = await processNotificationBatch(deps, 1);
    expect(result.permanentFailures).toBe(1);
    expect(deps.provider.send).not.toHaveBeenCalled();
    expect(deps.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "permanent_failure", code: "template_invalid" }));
  });
});
