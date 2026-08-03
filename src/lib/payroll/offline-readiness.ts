export type OfflinePayrollDeviceEvidence = {
  deviceId: string;
  deviceName: string;
  active: boolean;
  revokedAt: string | null;
  offlineEnabled: boolean;
  lastContactAt: string | null;
  lastReportedPendingCount: number;
  oldestPendingActionAt: string | null;
  unresolvedConflictCount: number;
  acceptedDriftWarningCount: number;
};

export type OfflinePayrollReadiness = {
  status: "ready" | "ready_with_warnings" | "not_ready";
  unresolvedConflicts: number;
  reportedPendingActions: number;
  unknownQueueDevices: number;
  staleOfflineDevices: number;
  acceptedDriftWarnings: number;
  revokedEvidenceDevices: number;
};

export function deriveOfflinePayrollReadiness(
  devices: OfflinePayrollDeviceEvidence[],
  payrollCutoff: string,
): OfflinePayrollReadiness {
  const cutoff = new Date(payrollCutoff).getTime();
  if (Number.isNaN(cutoff)) throw new RangeError("Payroll cutoff must be a valid timestamp");
  const relevant = devices.filter((device) => device.offlineEnabled);
  const result: Omit<OfflinePayrollReadiness, "status"> = {
    unresolvedConflicts: relevant.reduce((sum, device) => sum + device.unresolvedConflictCount, 0),
    reportedPendingActions: relevant.reduce((sum, device) => sum + device.lastReportedPendingCount, 0),
    unknownQueueDevices: relevant.filter((device) => device.active && !device.lastContactAt).length,
    staleOfflineDevices: relevant.filter((device) => device.active
      && device.lastContactAt !== null
      && new Date(device.lastContactAt).getTime() < cutoff
      && device.lastReportedPendingCount === 0).length,
    acceptedDriftWarnings: relevant.reduce((sum, device) => sum + device.acceptedDriftWarningCount, 0),
    revokedEvidenceDevices: relevant.filter((device) => !device.active
      && (device.lastReportedPendingCount > 0 || device.lastContactAt === null)).length,
  };
  const blocked = result.unresolvedConflicts > 0
    || result.reportedPendingActions > 0
    || result.unknownQueueDevices > 0
    || result.staleOfflineDevices > 0
    || result.revokedEvidenceDevices > 0;
  return {
    status: blocked
      ? "not_ready"
      : result.acceptedDriftWarnings > 0
        ? "ready_with_warnings"
        : "ready",
    ...result,
  };
}
