import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

describe("commercial session compatibility", () => {
  const originalSecret = process.env.COMMERCIAL_SESSION_SECRET;

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.COMMERCIAL_SESSION_SECRET;
    else process.env.COMMERCIAL_SESSION_SECRET = originalSecret;
  });

  it("does not require a commercial cookie secret when no selection cookie exists", async () => {
    delete process.env.COMMERCIAL_SESSION_SECRET;
    const { readCommercialPreference } = await import("@/lib/commercial-identity/session");
    await expect(readCommercialPreference()).resolves.toBeNull();
  });
});
