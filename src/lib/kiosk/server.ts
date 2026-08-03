import { createClient } from "@supabase/supabase-js";
import { getAppMode } from "@/lib/app-mode";
import { getSupabaseConfig, hasSupabaseConfig } from "@/lib/auth/config";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { getKioskDeviceToken } from "@/lib/kiosk/device-session";
import type { KioskRosterEntry } from "@/lib/kiosk/types";
import { isoDateInLondon } from "@/lib/dates/format";

type KioskRosterRow = {
  staff_id: string;
  display_name: string;
  full_name: string;
  employment_role: string;
  current_status: "clocked_in" | "clocked_out";
  pin_ready: boolean;
};

export class KioskDeviceAccessError extends Error {
  constructor(
    public readonly code: "device_missing" | "device_rejected" | "roster_failed",
    message: string,
  ) {
    super(message);
    this.name = "KioskDeviceAccessError";
  }
}

export function kioskRepositorySource(mode = getAppMode(), configured = hasSupabaseConfig()): "demo" | "supabase" {
  if (mode === "demo") return "demo";
  if (!configured) throw new Error("Production kiosk mode requires Supabase configuration.");
  return "supabase";
}

export function mapKioskRoster(rows: KioskRosterRow[]): KioskRosterEntry[] {
  return rows.map((row) => ({
    staffId: row.staff_id,
    displayName: row.display_name,
    fullName: row.full_name,
    employmentRole: row.employment_role,
    currentStatus: row.current_status,
    pinReady: row.pin_ready,
  }));
}

export function createPublicKioskClient() {
  const { url, anonKey } = getSupabaseConfig();
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export async function loadProductionKioskRoster(): Promise<KioskRosterEntry[]> {
  if (kioskRepositorySource() !== "supabase") return [];
  const deviceToken = await getKioskDeviceToken();
  if (!deviceToken) throw new KioskDeviceAccessError("device_missing", "Kiosk device access has not been activated.");
  const supabase = createPublicKioskClient();
  const { data, error } = await supabase.rpc("get_device_kiosk_roster", { device_token: deviceToken });
  if (error) {
    const rejected = /kiosk device access required/i.test(error.message);
    throw new KioskDeviceAccessError(
      rejected ? "device_rejected" : "roster_failed",
      rejected ? "The saved kiosk registration is no longer active." : "The Staff Clock roster could not be loaded.",
    );
  }
  return mapKioskRoster((data ?? []) as KioskRosterRow[]);
}

export type KioskDeviceRow = {
  id: string;
  deviceName: string;
  active: boolean;
  expiresAt: string;
  lastUsedAt: string | null;
  activatedAt: string;
  revokedAt: string | null;
  offlineEnabled: boolean;
  hardwareVerifiedAt: string | null;
  reprovisionRequired: boolean;
  schemaVersion: number;
  lastContactAt: string | null;
  lastRosterRefreshAt: string | null;
  authorisationExpiresAt: string | null;
  rosterVersion: string | null;
  appVersion: string | null;
  lastClockDriftSeconds: number | null;
  lastSuccessfulSyncAt: string | null;
  lastSyncFailureAt: string | null;
  lastSyncFailureCategory: string | null;
  pendingCount: number;
  oldestPendingActionAt: string | null;
  unresolvedConflictCount: number;
};

export async function loadKioskDevices(): Promise<KioskDeviceRow[]> {
  const supabase = await createSupabaseServerClient();
  const [devices, health, authorisations, conflicts] = await Promise.all([
    supabase.from("kiosk_devices")
      .select("id,device_name,active,expires_at,last_used_at,activated_at,revoked_at,offline_enabled,hardware_verified_at,reprovision_required,offline_schema_version")
      .order("activated_at", { ascending: false }),
    supabase.from("kiosk_sync_health")
      .select("kiosk_device_id,last_contact_at,last_roster_refresh_at,offline_authorisation_expires_at,roster_version,app_version,schema_version,last_clock_drift_seconds,last_successful_sync_at,last_sync_failure_at,last_sync_failure_category,last_reported_pending_count,oldest_pending_action_at"),
    supabase.from("kiosk_offline_authorisations")
      .select("kiosk_device_id,expires_at,roster_version,issued_at,revoked_at")
      .order("issued_at", { ascending: false }),
    supabase.from("attendance_exceptions")
      .select("kiosk_device_id")
      .eq("source", "offline_sync")
      .in("status", ["open", "under_review"]),
  ]);
  if (devices.error || health.error || authorisations.error || conflicts.error) {
    throw new Error("Kiosk devices could not be loaded.");
  }
  const healthByDevice = new Map((health.data ?? []).map((row) => [row.kiosk_device_id, row]));
  const authorisationByDevice = new Map<string, (typeof authorisations.data)[number]>();
  for (const row of authorisations.data ?? []) {
    if (!authorisationByDevice.has(row.kiosk_device_id)) authorisationByDevice.set(row.kiosk_device_id, row);
  }
  const conflictCounts = new Map<string, number>();
  for (const row of conflicts.data ?? []) {
    if (row.kiosk_device_id) conflictCounts.set(row.kiosk_device_id, (conflictCounts.get(row.kiosk_device_id) ?? 0) + 1);
  }
  return (devices.data ?? []).map((row) => {
    const report = healthByDevice.get(row.id);
    const authorisation = authorisationByDevice.get(row.id);
    return ({
    id: row.id,
    deviceName: row.device_name,
    active: row.active,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    activatedAt: row.activated_at,
    revokedAt: row.revoked_at,
    offlineEnabled: row.offline_enabled,
    hardwareVerifiedAt: row.hardware_verified_at,
    reprovisionRequired: row.reprovision_required,
    schemaVersion: row.offline_schema_version,
    lastContactAt: report?.last_contact_at ?? null,
    lastRosterRefreshAt: report?.last_roster_refresh_at ?? null,
    authorisationExpiresAt: report?.offline_authorisation_expires_at ?? authorisation?.expires_at ?? null,
    rosterVersion: report?.roster_version ?? authorisation?.roster_version ?? null,
    appVersion: report?.app_version ?? null,
    lastClockDriftSeconds: report?.last_clock_drift_seconds ?? null,
    lastSuccessfulSyncAt: report?.last_successful_sync_at ?? null,
    lastSyncFailureAt: report?.last_sync_failure_at ?? null,
    lastSyncFailureCategory: report?.last_sync_failure_category ?? null,
    pendingCount: report?.last_reported_pending_count ?? 0,
    oldestPendingActionAt: report?.oldest_pending_action_at ?? null,
    unresolvedConflictCount: conflictCounts.get(row.id) ?? 0,
  });
  });
}

export type ManagerKioskRow = KioskRosterEntry & {
  kioskEnabled: boolean;
  pinUpdatedAt: string | null;
  pinResetRequired: boolean;
  failedAttemptCount: number;
  lockedUntil: string | null;
  lastKioskUseAt: string | null;
};

export type ManagerClockEvent = {
  id: string;
  staffId: string;
  eventType: "clock_in" | "clock_out";
  eventTimestamp: string;
  recordedDate: string;
  eventSource: "kiosk" | "manager";
  managerCorrection: boolean;
  correctionReason: string | null;
};

export async function loadManagerAttendance(): Promise<{ staff: ManagerKioskRow[]; events: ManagerClockEvent[] }> {
  const supabase = await createSupabaseServerClient();
  const today = isoDateInLondon();
  const rangeStartDate = new Date(`${today}T12:00:00Z`);
  rangeStartDate.setUTCDate(rangeStartDate.getUTCDate() - 365);
  const [profiles, settings, events, statuses] = await Promise.all([
    supabase.from("staff_profiles").select("id,display_name,full_name,employment_role,active").order("full_name"),
    supabase.from("staff_kiosk_settings").select("staff_id,kiosk_enabled,pin_updated_at,pin_reset_required,failed_attempt_count,locked_until"),
    supabase.rpc("get_manager_effective_clock_events", { range_start: rangeStartDate.toISOString().slice(0, 10), range_end: today, target_staff_id: null }),
    supabase.rpc("get_manager_kiosk_statuses", { reference_date: today }),
  ]);
  if (profiles.error || settings.error || events.error || statuses.error) throw new Error("Production attendance could not be loaded.");
  const settingMap = new Map((settings.data ?? []).map((row) => [row.staff_id, row]));
  const eventRows = (events.data ?? []) as Array<Record<string, unknown>>;
  const statusByStaff = new Map(((statuses.data ?? []) as Array<Record<string, unknown>>)
    .map((row) => [String(row.staff_id), String(row.current_status)]));
  const lastKioskUseByStaff = new Map<string, string>();
  eventRows.sort((left, right) => String(right.event_timestamp).localeCompare(String(left.event_timestamp)));
  for (const event of eventRows) {
    const staffId = String(event.staff_id);
    if (String(event.source) === "kiosk" && !lastKioskUseByStaff.has(staffId)) {
      lastKioskUseByStaff.set(staffId, String(event.event_timestamp));
    }
  }
  return {
    staff: (profiles.data ?? []).filter((row) => row.active).map((row) => {
      const setting = settingMap.get(row.id);
      return {
        staffId: row.id,
        displayName: row.display_name,
        fullName: row.full_name,
        employmentRole: row.employment_role,
        currentStatus: statusByStaff.get(row.id) === "clocked_in" ? "clocked_in" : "clocked_out",
        pinReady: Boolean(setting?.pin_updated_at) && !setting?.pin_reset_required,
        kioskEnabled: setting?.kiosk_enabled ?? false,
        pinUpdatedAt: setting?.pin_updated_at ?? null,
        pinResetRequired: setting?.pin_reset_required ?? true,
        failedAttemptCount: setting?.failed_attempt_count ?? 0,
        lockedUntil: setting?.locked_until ?? null,
        lastKioskUseAt: lastKioskUseByStaff.get(row.id) ?? null,
      };
    }),
    events: eventRows.map((row) => ({
      id: String(row.event_id),
      staffId: String(row.staff_id),
      eventType: String(row.event_type) as "clock_in" | "clock_out",
      eventTimestamp: String(row.event_timestamp),
      recordedDate: String(row.recorded_date),
      eventSource: String(row.source) === "manager_correction" ? "manager" : "kiosk",
      managerCorrection: String(row.source) === "manager_correction",
      correctionReason: null,
    })),
  };
}
