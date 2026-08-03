import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { londonDateStartUtc } from "@/lib/dates/format";
import {
  deriveOfflinePayrollReadiness,
  type OfflinePayrollDeviceEvidence,
  type OfflinePayrollReadiness,
} from "@/lib/payroll/offline-readiness";

export async function loadOfflinePayrollReadiness(
  periodStart: string,
  periodEnd: string,
): Promise<OfflinePayrollReadiness> {
  const supabase = await createSupabaseServerClient();
  const [devices, health, conflicts, driftWarnings] = await Promise.all([
    supabase.from("kiosk_devices").select("id,device_name,active,revoked_at,offline_enabled"),
    supabase.from("kiosk_sync_health").select("kiosk_device_id,last_contact_at,last_reported_pending_count,oldest_pending_action_at"),
    supabase.from("attendance_exceptions")
      .select("kiosk_device_id")
      .eq("source", "offline_sync")
      .in("status", ["open", "under_review"])
      .gte("operational_date", periodStart)
      .lte("operational_date", periodEnd),
    supabase.from("clock_events")
      .select("kiosk_device_id")
      .eq("offline_warning", true)
      .gte("recorded_date", periodStart)
      .lte("recorded_date", periodEnd),
  ]);
  if (devices.error || health.error || conflicts.error || driftWarnings.error) {
    throw new Error("Offline kiosk payroll readiness could not be loaded.");
  }
  const healthByDevice = new Map((health.data ?? []).map((row) => [row.kiosk_device_id, row]));
  const conflictCounts = new Map<string, number>();
  for (const row of conflicts.data ?? []) {
    if (row.kiosk_device_id) conflictCounts.set(row.kiosk_device_id, (conflictCounts.get(row.kiosk_device_id) ?? 0) + 1);
  }
  const warningCounts = new Map<string, number>();
  for (const row of driftWarnings.data ?? []) {
    if (row.kiosk_device_id) warningCounts.set(row.kiosk_device_id, (warningCounts.get(row.kiosk_device_id) ?? 0) + 1);
  }
  const evidence: OfflinePayrollDeviceEvidence[] = (devices.data ?? []).map((device) => {
    const report = healthByDevice.get(device.id);
    return {
      deviceId: device.id,
      deviceName: device.device_name,
      active: device.active,
      revokedAt: device.revoked_at,
      offlineEnabled: device.offline_enabled,
      lastContactAt: report?.last_contact_at ?? null,
      lastReportedPendingCount: report?.last_reported_pending_count ?? 0,
      oldestPendingActionAt: report?.oldest_pending_action_at ?? null,
      unresolvedConflictCount: conflictCounts.get(device.id) ?? 0,
      acceptedDriftWarningCount: warningCounts.get(device.id) ?? 0,
    };
  });
  return deriveOfflinePayrollReadiness(evidence, londonDateStartUtc(periodStart).toISOString());
}
