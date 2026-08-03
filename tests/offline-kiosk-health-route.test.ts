import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("offline kiosk health route", () => {
  it("supports reachability checks and bounded queue-health reports", () => {
    const source = readFileSync(resolve("src/app/api/kiosk/offline/health/route.ts"), "utf8");

    expect(source).toContain("export async function GET");
    expect(source).toContain("export async function POST");
    expect(source).toContain("get_kiosk_offline_health_context");
    expect(source).toContain("report_kiosk_sync_health");
    expect(source).toContain("offlineHealthReportSchema");
    expect(source).toContain('"Cache-Control": "no-store"');
  });

  it("has no queue deletion or remote reset operation", () => {
    const source = readFileSync(resolve("src/app/api/kiosk/offline/health/route.ts"), "utf8");

    expect(source).not.toMatch(/delete|discard|reset/i);
  });
});
