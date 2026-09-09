import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
}));

vi.mock("@/lib/auth/post-auth-server", () => ({
  resolveAndApplyPostAuthDestination: mocks.resolve,
}));

import { GET, POST } from "@/app/auth/continue/route";

describe("post-auth continuation route", () => {
  it.each([
    ["GET", GET],
    ["POST", POST],
  ])("resolves %s requests through the same authoritative destination", async (method, handler) => {
    mocks.resolve.mockResolvedValueOnce("/organisations/sites?next=%2Fdashboard");

    const response = await handler(new Request(
      "https://staging.example.test/auth/continue?next=%2Fdashboard",
      { method },
    ));

    expect(mocks.resolve).toHaveBeenCalledWith("/dashboard");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://staging.example.test/organisations/sites?next=%2Fdashboard",
    );
  });
});
