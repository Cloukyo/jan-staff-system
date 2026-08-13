import { describe, expect, it } from "vitest";
import {
  staffInvitationSelectionPayloadSchema,
  staffInvitationSkipPayloadSchema,
  staffInvitationSnapshotSchema,
} from "@/lib/onboarding/staff-invitation-contracts";

describe("commercial staff invitation contracts", () => {
  it("accepts only a bounded unique reviewed set of existing staff IDs", () => {
    expect(
      staffInvitationSelectionPayloadSchema.parse({
        staffIds: ["fictional_staff_001", "fictional_staff_002"],
        reviewedSetHash: "a".repeat(64),
      }),
    ).toEqual({
      staffIds: ["fictional_staff_001", "fictional_staff_002"],
      reviewedSetHash: "a".repeat(64),
    });
    expect(
      staffInvitationSelectionPayloadSchema.safeParse({
        staffIds: ["fictional_staff_001", "fictional_staff_001"],
        reviewedSetHash: "a".repeat(64),
      }).success,
    ).toBe(false);
    expect(
      staffInvitationSelectionPayloadSchema.safeParse({
        staffIds: ["fictional_staff_001"],
        reviewedSetHash: "a".repeat(64),
        role: "organisation_owner",
        siteIds: ["31000000-0000-4000-8000-000000000010"],
      }).success,
    ).toBe(false);
  });

  it("requires the exact invite-later acknowledgement", () => {
    expect(
      staffInvitationSkipPayloadSchema.parse({
        acknowledgement: "invite_staff_later",
      }),
    ).toEqual({ acknowledgement: "invite_staff_later" });
    expect(
      staffInvitationSkipPayloadSchema.safeParse({ acknowledgement: "later" })
        .success,
    ).toBe(false);
  });

  it("keeps staff-profile, account and delivery states distinct", () => {
    const parsed = staffInvitationSnapshotSchema.parse({
      skipped: false,
      staff: [
        {
          staffId: "fictional_staff_001",
          displayName: "Taylor Example",
          maskedEmail: "t***@example.invalid",
          siteIds: ["31000000-0000-4000-8000-000000000010"],
          accountState: "invitation_pending",
          invitationId: "31000000-0000-4000-8000-000000000011",
          invitationStatus: "pending",
          deliveryStatus: "retryable_failure",
          attendanceMode: "account_optional",
        },
      ],
    });
    expect(parsed.staff[0]).toMatchObject({
      accountState: "invitation_pending",
      deliveryStatus: "retryable_failure",
      attendanceMode: "account_optional",
    });
  });
});
