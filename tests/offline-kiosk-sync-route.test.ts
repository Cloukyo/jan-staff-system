import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("offline sync route boundary", () => {
  it("validates device cookie, binding, signature and schema before the server-only RPC", () => {
    const source = readFileSync(resolve("src/app/api/kiosk/offline/sync/route.ts"), "utf8");

    expect(source).toContain("getKioskDeviceToken");
    expect(source).toContain("offlineSyncRequestSchema");
    expect(source).toContain("get_offline_kiosk_sync_context");
    expect(source).toContain("verifyOfflinePayload");
    expect(source).toContain("perform_offline_kiosk_attendance_action");
    expect(source).toContain('"Cache-Control": "no-store"');
  });

  it("does not log signatures, verifier material or raw database errors", () => {
    const source = readFileSync(resolve("src/app/api/kiosk/offline/sync/route.ts"), "utf8");

    const logStatements = source.split("\n").filter((line) => /console\.(?:warn|error)/.test(line));
    expect(logStatements.join("\n")).not.toMatch(/signature|verifier|error\.message/i);
    expect(source).not.toMatch(/NEXT_PUBLIC_.*SERVICE|serviceRoleKey/);
  });
});
