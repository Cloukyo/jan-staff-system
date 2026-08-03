import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("offline kiosk interface", () => {
  it("shows every required connection and authorisation state", () => {
    const source = readFileSync(resolve("src/components/kiosk/offline-status.tsx"), "utf8");

    for (const text of [
      "Online",
      "Offline - actions will sync later",
      "Synchronising",
      "Sync conflict",
      "Authorisation expiring",
      "Authorisation expired",
      "Device revoked",
      "Update required",
      "Sync now",
    ]) expect(source).toContain(text);
    expect(source).toContain("Pending actions");
    expect(source).toContain("Last successful sync");
  });

  it("uses provisional confirmations and the durable queue in the existing kiosk", () => {
    const source = readFileSync(resolve("src/components/kiosk/production-kiosk.tsx"), "utf8");

    expect(source).toContain("verifyStoredOfflinePin");
    expect(source).toContain("queueProvisionalAttendanceAction");
    expect(source).toContain("Pending synchronisation");
    expect(source).toContain("enrolVerifiedOfflinePin");
    expect(source).not.toMatch(/offline.*toggle|toggle.*offline/i);
  });

  it("registers launch, connectivity, visibility, periodic, manual and background triggers", () => {
    const source = readFileSync(resolve("src/components/kiosk/use-offline-kiosk.ts"), "utf8");

    for (const trigger of ["launch", "online", "visibility", "periodic", "manual", "background"]) {
      expect(source).toContain(`"${trigger}"`);
    }
    expect(source).toContain("OFFLINE_SYNC_REQUESTED");
    expect(source).toContain("setInterval");
  });
});
