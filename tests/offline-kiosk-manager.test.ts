import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  deriveOfflinePayrollReadiness,
  type OfflinePayrollDeviceEvidence,
} from "@/lib/payroll/offline-readiness";

const healthy: OfflinePayrollDeviceEvidence = {
  deviceId: "device-1",
  deviceName: "Fictional nursery tablet",
  active: true,
  revokedAt: null,
  offlineEnabled: true,
  lastContactAt: "2026-07-31T15:00:00Z",
  lastReportedPendingCount: 0,
  oldestPendingActionAt: null,
  unresolvedConflictCount: 0,
  acceptedDriftWarningCount: 0,
};

describe("offline kiosk payroll readiness", () => {
  it("does not block a healthy kiosk reporting no pending evidence", () => {
    expect(deriveOfflinePayrollReadiness([healthy], "2026-07-15T00:00:00Z")).toEqual({
      status: "ready",
      unresolvedConflicts: 0,
      reportedPendingActions: 0,
      unknownQueueDevices: 0,
      staleOfflineDevices: 0,
      acceptedDriftWarnings: 0,
      revokedEvidenceDevices: 0,
    });
  });

  it("blocks unresolved, pending, stale, unknown and revoked attendance evidence", () => {
    const evidence: OfflinePayrollDeviceEvidence[] = [
      { ...healthy, unresolvedConflictCount: 2 },
      { ...healthy, deviceId: "device-2", lastReportedPendingCount: 3, oldestPendingActionAt: "2026-07-30T08:00:00Z" },
      { ...healthy, deviceId: "device-3", lastContactAt: null },
      { ...healthy, deviceId: "device-4", lastContactAt: "2026-07-01T08:00:00Z" },
      { ...healthy, deviceId: "device-5", active: false, revokedAt: "2026-07-20T09:00:00Z", lastReportedPendingCount: 1, oldestPendingActionAt: "2026-07-19T08:00:00Z" },
    ];
    const result = deriveOfflinePayrollReadiness(evidence, "2026-07-15T00:00:00Z");
    expect(result.status).toBe("not_ready");
    expect(result.unresolvedConflicts).toBe(2);
    expect(result.reportedPendingActions).toBe(4);
    expect(result.unknownQueueDevices).toBe(1);
    expect(result.staleOfflineDevices).toBe(1);
    expect(result.revokedEvidenceDevices).toBe(1);
  });

  it("reports accepted drift as a warning without counting pending hours", () => {
    const result = deriveOfflinePayrollReadiness(
      [{ ...healthy, acceptedDriftWarningCount: 2 }],
      "2026-07-15T00:00:00Z",
    );
    expect(result.status).toBe("ready_with_warnings");
    expect(result.acceptedDriftWarnings).toBe(2);
    expect(result.reportedPendingActions).toBe(0);
  });
});

describe("manager kiosk recovery controls", () => {
  it("shows health evidence and guards reprovision actions behind manager access", () => {
    const server = readFileSync(resolve("src/lib/kiosk/server.ts"), "utf8");
    const actions = readFileSync(resolve("src/lib/kiosk/device-actions.ts"), "utf8");
    const screen = readFileSync(resolve("src/components/kiosk/device-management.tsx"), "utf8");
    expect(server).toContain('from("kiosk_sync_health")');
    expect(server).toContain('from("kiosk_offline_authorisations")');
    expect(server).toContain('.eq("source", "offline_sync")');
    expect(actions).toContain("requireKioskReprovisionAction");
    expect(actions).toContain("allowKioskReprovisionAction");
    expect(actions).toContain('requireAccount(["manager"])');
    expect(screen).toContain("Last roster refresh");
    expect(screen).toContain("Pending actions");
    expect(screen).toContain("View sync conflicts");
    expect(screen).toContain("Never erase or reset the old device");
  });
});
