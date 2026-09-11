import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { offlineKioskStatus } from "@/lib/kiosk/presentation";

describe("Staff Clock connection presentation", () => {
  it("explains online, offline and blocked device states in staff language", () => {
    expect(offlineKioskStatus("online", { lifecycle: "current", pendingCount: 0, conflictCount: 0 })).toMatchObject({ heading: "Online and ready", tone: "green" });
    expect(offlineKioskStatus("offline", { lifecycle: "current", pendingCount: 0, conflictCount: 0 })).toMatchObject({ heading: "Offline mode", tone: "amber" });
    expect(offlineKioskStatus("revoked", { lifecycle: "current", pendingCount: 0, conflictCount: 0 })).toMatchObject({ heading: "Device unavailable", tone: "red" });
    expect(offlineKioskStatus("online", { lifecycle: "current", pendingCount: 1, conflictCount: 1 }).body).toMatch(/manager review/i);
  });
});

describe("Staff Clock interaction surface", () => {
  const kiosk = readFileSync(resolve("src/components/kiosk/production-kiosk.tsx"), "utf8");
  const keypad = readFileSync(resolve("src/components/kiosk/pin-keypad.tsx"), "utf8");
  const offline = readFileSync(resolve("src/components/kiosk/offline-status.tsx"), "utf8");

  it("supports quick staff lookup and clear selected identity", () => {
    expect(kiosk).toContain('placeholder="Find your name"');
    expect(kiosk).toContain("selected.displayName");
    expect(kiosk).toContain('aria-label="Staff Clock users"');
  });

  it("announces changing messages and labels the masked PIN entry", () => {
    expect(kiosk).toContain('role="status"');
    expect(kiosk).toContain('aria-live="polite"');
    expect(keypad).toContain('role="group"');
    expect(keypad).toContain("digits entered");
    expect(keypad).toContain('aria-label={`Enter digit ${digit}`}');
  });

  it("returns to the safe start after online and offline success", () => {
    expect(kiosk.match(/scheduleSafeReset\(\)/g)?.length).toBe(2);
  });

  it("keeps technical connection details secondary", () => {
    expect(offline).toContain("Connection details");
    expect(offline).toContain("<details");
    expect(offline).not.toContain("Authorisation expired");
  });
});
