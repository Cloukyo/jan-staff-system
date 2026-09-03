import { describe, expect, it } from "vitest";
import {
  createPilotEmailHmac,
  normalisePilotEmail,
} from "@/lib/pilot-access/email-hmac";

describe("pilot email HMAC", () => {
  const secret = "a-purpose-specific-secret-that-is-at-least-32-bytes";

  it("normalises case and surrounding whitespace deterministically", () => {
    expect(normalisePilotEmail("  Owner@Example.COM  ")).toBe("owner@example.com");
    expect(createPilotEmailHmac("  Owner@Example.COM  ", secret)).toBe(
      createPilotEmailHmac("owner@example.com", secret),
    );
  });

  it("is keyed and does not expose the email", () => {
    const first = createPilotEmailHmac("owner@example.com", secret);
    const second = createPilotEmailHmac(
      "owner@example.com",
      "a-different-purpose-secret-that-is-at-least-32-bytes",
    );

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain("owner");
    expect(first).not.toBe(second);
  });

  it("rejects an undersized key", () => {
    expect(() => createPilotEmailHmac("owner@example.com", "too-short")).toThrow(
      /at least 32/i,
    );
  });
});

