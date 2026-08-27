import { describe, expect, it } from "vitest";
import {
  managerInvitationPath,
  safeCommercialContinuation,
} from "@/lib/invitations/continuation";

describe("manager invitation continuations", () => {
  const token = "fictional_manager_invitation_token_1234567890";
  const path = `/invitations/manager?token=${token}`;

  it("preserves the fixed invitation route and token", () => {
    expect(managerInvitationPath(token)).toBe(path);
    expect(safeCommercialContinuation(path)).toBe(path);
  });

  it("allows known onboarding destinations", () => {
    expect(safeCommercialContinuation("/onboarding")).toBe("/onboarding");
    expect(safeCommercialContinuation("/onboarding/managers")).toBe(
      "/onboarding/managers",
    );
  });

  it.each([
    "https://attacker.example/invitations/manager?token=fictional_manager_invitation_token_1234567890",
    "//attacker.example/invitations/manager?token=fictional_manager_invitation_token_1234567890",
    "/dashboard",
    "/invitations/manager?token=short",
    "/invitations/manager?token=fictional_manager_invitation_token_1234567890&redirect=https://attacker.example",
  ])("rejects unsafe continuation %s", (value) => {
    expect(safeCommercialContinuation(value)).toBeNull();
  });
});
