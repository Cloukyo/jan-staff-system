import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

describe("commercial security headers", () => {
  it("applies the required browser security policy to every route", async () => {
    const rules = await nextConfig.headers?.();
    const global = rules?.find((rule) => rule.source === "/(.*)");
    const headers = new Map(global?.headers.map((header) => [header.key, header.value]));

    expect(headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    expect(headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(headers.get("Content-Security-Policy")).toContain("object-src 'none'");
    expect(headers.get("Strict-Transport-Security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("Permissions-Policy")).toContain("camera=()");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("serves the service worker with no-store and a script-only policy", async () => {
    const rules = await nextConfig.headers?.();
    const serviceWorker = rules?.find((rule) => rule.source === "/sw.js");
    const headers = new Map(
      serviceWorker?.headers.map((header) => [header.key, header.value]),
    );

    expect(headers.get("Cache-Control")).toBe("no-cache, no-store, must-revalidate");
    expect(headers.get("Content-Security-Policy")).toBe(
      "default-src 'self'; script-src 'self'",
    );
  });
});
