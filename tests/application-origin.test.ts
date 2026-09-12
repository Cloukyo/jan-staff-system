import { describe, expect, it } from "vitest";
import { applicationUrl, canonicalApplicationOrigin } from "@/lib/auth/application-origin";

describe("canonical application origin", () => {
  it("normalises a trusted application origin", () => {
    expect(canonicalApplicationOrigin(" https://app.example.test/ ", "production")).toBe("https://app.example.test");
    expect(applicationUrl("/auth/callback?next=%2Fdashboard", "https://app.example.test/", "production"))
      .toBe("https://app.example.test/auth/callback?next=%2Fdashboard");
  });

  it.each([
    "https://user:secret@app.example.test",
    "https://app.example.test/unexpected-path",
    "https://app.example.test?redirect=https://evil.example",
    "https://app.example.test/#fragment",
  ])("rejects a non-origin SITE_URL: %s", (configured) => {
    expect(() => canonicalApplicationOrigin(configured, "production")).toThrow("application origin");
  });

  it("requires HTTPS outside local development", () => {
    expect(() => canonicalApplicationOrigin("http://app.example.test", "staging")).toThrow("HTTPS");
    expect(canonicalApplicationOrigin("http://localhost:3000/", "local")).toBe("http://localhost:3000");
  });

  it("accepts only application-relative destination paths", () => {
    expect(() => applicationUrl("https://evil.example", "https://app.example.test", "production"))
      .toThrow("application-relative");
    expect(() => applicationUrl("//evil.example/path", "https://app.example.test", "production"))
      .toThrow("application-relative");
  });
});
