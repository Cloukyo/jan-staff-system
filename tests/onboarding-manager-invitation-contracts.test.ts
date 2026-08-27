import { describe, expect, it } from "vitest";
import {
  MANAGER_INVITATION_ROLES,
  managerInvitationPayloadSchema,
  managerInvitationSnapshotSchema,
} from "@/lib/onboarding/manager-invitation-contracts";

describe("commercial manager invitation contracts", () => {
  it("exposes only approved grantable manager roles", () => {
    expect(MANAGER_INVITATION_ROLES).toEqual([
      "organisation_admin",
      "hr_admin",
      "payroll_admin",
      "site_manager",
      "scheduler",
    ]);
    expect(
      managerInvitationPayloadSchema.safeParse({
        email: "owner@example.test",
        role: "organisation_owner",
        scopeType: "organisation",
        siteIds: [],
      }).success,
    ).toBe(false);
  });

  it("normalises email and keeps role scope distinct from site access", () => {
    expect(
      managerInvitationPayloadSchema.parse({
        email: " Manager@Example.Test ",
        role: "site_manager",
        scopeType: "site",
        siteIds: ["31000000-0000-4000-8000-000000000010"],
      }),
    ).toEqual({
      email: "manager@example.test",
      role: "site_manager",
      scopeType: "site",
      siteIds: ["31000000-0000-4000-8000-000000000010"],
    });
    expect(
      managerInvitationPayloadSchema.safeParse({
        email: "manager@example.test",
        role: "site_manager",
        scopeType: "site",
        siteIds: [],
      }).success,
    ).toBe(false);
    expect(
      managerInvitationPayloadSchema.safeParse({
        email: "manager@example.test",
        role: "organisation_admin",
        scopeType: "organisation",
        siteIds: ["31000000-0000-4000-8000-000000000010"],
      }).success,
    ).toBe(false);
  });

  it("reports invitation, delivery and acceptance independently", () => {
    const parsed = managerInvitationSnapshotSchema.parse({
      soleManagerAcknowledged: false,
      invitations: [
        {
          id: "31000000-0000-4000-8000-000000000011",
          email: "manager@example.test",
          role: "site_manager",
          scopeType: "site",
          siteIds: ["31000000-0000-4000-8000-000000000010"],
          status: "pending",
          deliveryStatus: "retryable_failure",
          createdAt: "2026-08-13T12:00:00+00:00",
          expiresAt: "2026-08-20T12:00:00+00:00",
          acceptedAt: null,
        },
      ],
    });
    expect(parsed.invitations[0]).toMatchObject({
      status: "pending",
      deliveryStatus: "retryable_failure",
      acceptedAt: null,
    });
  });
});
