import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { offlineKioskStatus } from "@/lib/kiosk/presentation";

describe("offline kiosk interface", () => {
  it("shows every required connection and authorisation state", () => {
    const current = { lifecycle: "current", pendingCount: 0, conflictCount: 0 };
    expect(offlineKioskStatus("online", current).heading).toBe("Online and ready");
    expect(offlineKioskStatus("offline", current).heading).toBe("Offline mode");
    expect(offlineKioskStatus("synchronising", current).heading).toBe("Updating Staff Clock");
    expect(offlineKioskStatus("sync_problem", current).heading).toBe("Connection problem");
    expect(offlineKioskStatus("revoked", current).heading).toBe("Device unavailable");
    expect(offlineKioskStatus("update_required", current).heading).toBe("Reconnect before clocking");
    expect(offlineKioskStatus("online", { ...current, lifecycle: "expiring" }).heading).toBe("Reconnect soon");
    expect(offlineKioskStatus("online", { ...current, lifecycle: "expired" }).heading).toBe("Reconnect before clocking");
    expect(offlineKioskStatus("online", { ...current, conflictCount: 1 }).heading).toBe("Some actions need review");

    const source = readFileSync(resolve("src/components/kiosk/offline-status.tsx"), "utf8");
    expect(source).toContain("Connection details");
    expect(source).toContain("Saved actions waiting");
    expect(source).toContain("Last successful connection");
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
