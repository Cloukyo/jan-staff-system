import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("offline provisioning route boundary", () => {
  it("uses the HttpOnly device session and a server-only database client", () => {
    const source = readFileSync(resolve("src/app/api/kiosk/offline/provision/route.ts"), "utf8");

    expect(source).toContain("getKioskDeviceToken");
    expect(source).toContain("createSupabaseAdminClient");
    expect(source).toContain("offlineProvisionRequestSchema");
    expect(source).toContain('"Cache-Control": "no-store"');
    expect(source).not.toMatch(/NEXT_PUBLIC_.*SERVICE|serviceRoleKey/);
  });

  it("limits request size and redacts database errors", () => {
    const source = readFileSync(resolve("src/app/api/kiosk/offline/provision/route.ts"), "utf8");

    expect(source).toContain("16_384");
    expect(source).not.toContain("error.message },");
    expect(source).toContain('category: rateLimited ? "rate_limited" : "database_unavailable"');
  });
});
