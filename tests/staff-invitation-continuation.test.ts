import { describe, expect, it } from "vitest";
import {
  safeCommercialContinuation,
  staffInvitationPath,
} from "@/lib/invitations/continuation";
describe("staff invitation continuation", () => {
  const token = "fictional_staff_invitation_token_1234567890";
  it("preserves only a strict internal staff invitation token route", () => {
    expect(staffInvitationPath(token)).toBe(
      `/invitations/staff?token=${token}`,
    );
    expect(
      safeCommercialContinuation(`/invitations/staff?token=${token}`),
    ).toBe(`/invitations/staff?token=${token}`);
    for (const value of [
      `https://attacker.example/invitations/staff?token=${token}`,
      `/invitations/staff?token=${token}&next=https://attacker.example`,
      `//attacker.example/invitations/staff?token=${token}`,
    ])
      expect(safeCommercialContinuation(value)).toBeNull();
  });
});
