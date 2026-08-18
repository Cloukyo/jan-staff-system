import { describe, expect, it } from "vitest";
import { invitationDeliveryMessage } from "@/lib/commercial-admin/invitation-delivery";

describe("commercial invitation delivery recovery copy", () => {
  it("keeps invitation creation success distinct from retrying email delivery", () => {
    expect(invitationDeliveryMessage("retrying")).toEqual({
      text: "Invitation created. Email delivery will retry.",
      tone: "warning",
    });
  });

  it("explains a permanent delivery failure without suggesting duplicate creation", () => {
    const message = invitationDeliveryMessage("permanently_failed");
    expect(message.tone).toBe("error");
    expect(message.text).toContain("Invitation created");
    expect(message.text).toContain("Use resend");
    expect(message.text).not.toContain("Create another invitation");
  });
});
