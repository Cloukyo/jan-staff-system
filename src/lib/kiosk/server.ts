import { createClient } from "@supabase/supabase-js";
import { getAppMode } from "@/lib/app-mode";
import { getSupabaseConfig, hasSupabaseConfig } from "@/lib/auth/config";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import {
  resolveEffectiveEvents,
  type AttendanceCorrection,
  type AttendanceCorrectionKind,
  type AttendanceEventType,
  type OriginalClockEvent,
} from "@/lib/attendance/effective-events";
import { isoDateInLondon } from "@/lib/dates/format";
import { getKioskDeviceToken } from "@/lib/kiosk/device-session";
import {
  loadAllPostgrestPages,
  type PostgrestPage,
} from "@/lib/repositories/postgrest-pagination";
import type { KioskRosterEntry } from "@/lib/kiosk/types";
import { requireAttendanceActor } from "@/lib/attendance/server-actor";

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

export async function loadCommercialKioskPreLiveState(): Promise<{ preLive: boolean; siteName: string; staffCount: number } | null> {
  const deviceToken = await getKioskDeviceToken();
  if (!deviceToken) return null;
  const client = createPublicKioskClient();
  const { data: health, error: healthError } = await client.rpc("record_commercial_kiosk_heartbeat", { device_token: deviceToken, app_version: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || "0.1.0", protocol_version: 1, platform_category: "tablet" });
  if (healthError || !health || typeof health !== "object" || !(health as { preLive?: boolean }).preLive) return null;
  const { data: roster, error: rosterError } = await client.rpc("verify_commercial_kiosk_roster", { device_token: deviceToken });
  if (rosterError || !roster || typeof roster !== "object") throw new KioskDeviceAccessError("roster_failed", "The commercial kiosk roster could not be verified.");
  const result = roster as { siteName?: string; staff?: unknown[] };
  return { preLive: true, siteName: result.siteName ?? "your location", staffCount: Array.isArray(result.staff) ? result.staff.length : 0 };
}

export async function loadProductionKioskRoster(): Promise<KioskRosterEntry[]> {
  if (kioskRepositorySource() !== "supabase") return [];
  const deviceToken = await getKioskDeviceToken();
  if (!deviceToken) throw new KioskDeviceAccessError("device_missing", "Kiosk device access has not been activated.");
  const supabase = createPublicKioskClient();
  const { data, error } = await supabase.rpc("get_tenant_aware_device_kiosk_roster", { device_token: deviceToken });
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
    if (!authorisationByDevice.has(row.kiosk_device_id)) {
      authorisationByDevice.set(row.kiosk_device_id, row);
    }
  }
  const conflictCounts = new Map<string, number>();
  for (const row of conflicts.data ?? []) {
    if (row.kiosk_device_id) {
      conflictCounts.set(
        row.kiosk_device_id,
        (conflictCounts.get(row.kiosk_device_id) ?? 0) + 1,
      );
    }
  }
  return (devices.data ?? []).map((row) => {
    const report = healthByDevice.get(row.id);
    const authorisation = authorisationByDevice.get(row.id);
    return {
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
    };
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
  recordType: "original" | "correction";
  eventType: AttendanceEventType | null;
  eventTimestamp: string | null;
  recordedDate: string;
  eventSource: "kiosk" | "manager" | "manager_correction";
  managerCorrection: boolean;
  correctionReason: string | null;
  auditStatus: "active" | "replaced" | "excluded" | "superseded";
  correctionKind: AttendanceCorrectionKind | null;
  originalEventId: string | null;
  supersedesCorrectionId: string | null;
  createdAt: string;
  createdByName: string | null;
};

type ManagerClockEventSourceRow = {
  id: string;
  staff_id: string;
  event_type: AttendanceEventType;
  event_timestamp: string;
  recorded_date: string;
  event_source: "kiosk" | "manager";
  manager_correction: boolean;
  correction_reason: string | null;
  created_at: string;
};

type ManagerClockCorrectionSourceRow = {
  id: string;
  staff_id: string;
  correction_kind: AttendanceCorrectionKind;
  original_event_id: string | null;
  supersedes_correction_id: string | null;
  event_type: AttendanceEventType | null;
  event_timestamp: string | null;
  recorded_date: string;
  reason: string;
  created_by: string;
  created_at: string;
};

export async function loadManagerClockHistorySources(
  loadOriginalPage: (
    from: number,
    to: number,
  ) => PromiseLike<PostgrestPage<ManagerClockEventSourceRow>>,
  loadCorrectionPage: (
    from: number,
    to: number,
  ) => PromiseLike<PostgrestPage<ManagerClockCorrectionSourceRow>>,
  pageSize = 1_000,
): Promise<{
  originalRows: ManagerClockEventSourceRow[];
  correctionRows: ManagerClockCorrectionSourceRow[];
}> {
  const [originalRows, correctionRows] = await Promise.all([
    loadAllPostgrestPages(loadOriginalPage, pageSize),
    loadAllPostgrestPages(loadCorrectionPage, pageSize),
  ]);
  return { originalRows, correctionRows };
}

type ManagerEffectiveStatusRow = {
  staff_id: string;
  current_status: KioskRosterEntry["currentStatus"];
};

export function mapEffectiveManagerStatuses(
  rows: ManagerEffectiveStatusRow[],
): Map<string, KioskRosterEntry["currentStatus"]> {
  return new Map(rows.map((row) => [
    row.staff_id,
    row.current_status,
  ]));
}

export function buildManagerClockHistory(
  originalRows: ManagerClockEventSourceRow[],
  correctionRows: ManagerClockCorrectionSourceRow[],
  accountNames: Map<string, string>,
): ManagerClockEvent[] {
  const originals: OriginalClockEvent[] = originalRows.map((row) => ({
    id: row.id,
    staffId: row.staff_id,
    eventType: row.event_type,
    eventTimestamp: row.event_timestamp,
    recordedDate: row.recorded_date,
    source: row.event_source === "manager" || row.manager_correction
      ? "legacy_manager"
      : "kiosk",
  }));
  const corrections: AttendanceCorrection[] = correctionRows.map((row) => ({
    id: row.id,
    staffId: row.staff_id,
    kind: row.correction_kind,
    originalEventId: row.original_event_id,
    eventType: row.event_type,
    eventTimestamp: row.event_timestamp,
    recordedDate: row.recorded_date,
    supersedesCorrectionId: row.supersedes_correction_id,
    createdAt: row.created_at,
  }));
  const audit = resolveEffectiveEvents(originals, corrections).audit;
  const originalStatus = new Map(audit.originals.map((record) => [
    record.event.id,
    record.status,
  ]));
  const correctionStatus = new Map(audit.corrections.map((record) => [
    record.correctionId,
    record.status,
  ]));

  return [
    ...originalRows.map((row): ManagerClockEvent => ({
      id: row.id,
      staffId: row.staff_id,
      recordType: "original",
      eventType: row.event_type,
      eventTimestamp: row.event_timestamp,
      recordedDate: row.recorded_date,
      eventSource: row.event_source,
      managerCorrection: row.event_source === "manager" || row.manager_correction,
      correctionReason: row.correction_reason,
      auditStatus: originalStatus.get(row.id) ?? "active",
      correctionKind: null,
      originalEventId: null,
      supersedesCorrectionId: null,
      createdAt: row.created_at,
      createdByName: null,
    })),
    ...correctionRows.map((row): ManagerClockEvent => ({
      id: row.id,
      staffId: row.staff_id,
      recordType: "correction",
      eventType: row.event_type,
      eventTimestamp: row.event_timestamp,
      recordedDate: row.recorded_date,
      eventSource: "manager_correction",
      managerCorrection: true,
      correctionReason: row.reason,
      auditStatus: correctionStatus.get(row.id) ?? "superseded",
      correctionKind: row.correction_kind,
      originalEventId: row.original_event_id,
      supersedesCorrectionId: row.supersedes_correction_id,
      createdAt: row.created_at,
      createdByName: accountNames.get(row.created_by) ?? "Manager account",
    })),
  ].sort((left, right) => (
    Date.parse(right.createdAt) - Date.parse(left.createdAt)
    || right.id.localeCompare(left.id)
  ));
}

export async function loadManagerAttendance(): Promise<{ staff: ManagerKioskRow[]; events: ManagerClockEvent[] }> {
  const actor = await requireAttendanceActor("attendance.read", { siteRequired: true });
  const supabase = await createSupabaseServerClient();
  if (actor.kind === "commercial") {
    const organisationId = actor.context.organisationId;
    const siteId = actor.context.selectedSiteId!;
    const today = isoDateInLondon();
    const [profiles, assignments, originals, corrections] = await Promise.all([
      supabase.from("staff_profiles").select("id,display_name,full_name,employment_role,active")
        .eq("organisation_id", organisationId).eq("active", true).order("full_name"),
      supabase.from("staff_site_assignments").select("staff_id").eq("organisation_id", organisationId)
        .eq("site_id", siteId).lte("effective_from", today).or(`effective_to.is.null,effective_to.gte.${today}`),
      loadAllPostgrestPages<ManagerClockEventSourceRow>((from, to) => supabase.from("clock_events")
        .select("id,staff_id,event_type,event_timestamp,recorded_date,event_source,manager_correction,correction_reason,created_at")
        .eq("organisation_id", organisationId).eq("site_id", siteId)
        .order("event_timestamp", { ascending: false }).order("id", { ascending: false }).range(from, to)),
      loadAllPostgrestPages<ManagerClockCorrectionSourceRow>((from, to) => supabase.from("clock_event_corrections")
        .select("id,staff_id,correction_kind,original_event_id,supersedes_correction_id,event_type,event_timestamp,recorded_date,reason,created_by,created_at")
        .eq("organisation_id", organisationId).eq("site_id", siteId)
        .order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to)),
    ]);
    if (profiles.error || assignments.error) throw new Error("Production attendance could not be loaded.");
    const eligible = new Set((assignments.data ?? []).map((row) => row.staff_id));
    const staffRows = (profiles.data ?? []).filter((row) => eligible.has(row.id));
    const states = await Promise.all(staffRows.map((row) => supabase.rpc("get_commercial_attendance_state", {
      target_organisation_id: organisationId,target_site_id: siteId,target_staff_id: row.id,evaluated_at: new Date().toISOString(),
    })));
    if (states.some((state) => state.error)) throw new Error("Production attendance state could not be loaded.");
    return {
      staff: staffRows.map((row, index) => ({
        staffId: row.id,displayName: row.display_name,fullName: row.full_name,employmentRole: row.employment_role,
        currentStatus: (states[index].data as { state?: string } | null)?.state === "clocked_in" ? "clocked_in" : "clocked_out",
        pinReady: false,kioskEnabled: true,pinUpdatedAt: null,pinResetRequired: false,
        failedAttemptCount: 0,lockedUntil: null,lastKioskUseAt: null,
      })),
      events: buildManagerClockHistory(originals, corrections, new Map()),
    };
  }
  const [profiles, settings, history, accounts, effectiveStatuses] = await Promise.all([
    supabase.from("staff_profiles").select("id,display_name,full_name,employment_role,active").order("full_name"),
    supabase.from("staff_kiosk_settings").select("staff_id,kiosk_enabled,pin_updated_at,pin_reset_required,failed_attempt_count,locked_until"),
    loadManagerClockHistorySources(
      (from, to) => supabase.from("clock_events")
        .select("id,staff_id,event_type,event_timestamp,recorded_date,event_source,manager_correction,correction_reason,created_at")
        .order("event_timestamp", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to),
      (from, to) => supabase.from("clock_event_corrections")
        .select("id,staff_id,correction_kind,original_event_id,supersedes_correction_id,event_type,event_timestamp,recorded_date,reason,created_by,created_at")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to),
    ),
    supabase.from("staff_accounts").select("id,full_name").eq("role", "manager"),
    supabase.rpc("get_manager_kiosk_statuses", {
      reference_date: isoDateInLondon(),
    }),
  ]);
  if (profiles.error || settings.error || accounts.error || effectiveStatuses.error) {
    throw new Error("Production attendance could not be loaded.");
  }
  const settingMap = new Map((settings.data ?? []).map((row) => [row.staff_id, row]));
  const eventRows = history.originalRows;
  const correctionRows = history.correctionRows;
  const accountNames = new Map(
    (accounts.data ?? []).map((row) => [String(row.id), String(row.full_name)]),
  );
  const statusByStaff = mapEffectiveManagerStatuses(
    (effectiveStatuses.data ?? []) as ManagerEffectiveStatusRow[],
  );
  const lastKioskUseByStaff = new Map<string, string>();
  for (const event of eventRows) {
    const staffId = String(event.staff_id);
    if (String(event.event_source) === "kiosk" && !lastKioskUseByStaff.has(staffId)) {
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
        currentStatus: statusByStaff.get(row.id) ?? "clocked_out",
        pinReady: Boolean(setting?.pin_updated_at) && !setting?.pin_reset_required,
        kioskEnabled: setting?.kiosk_enabled ?? false,
        pinUpdatedAt: setting?.pin_updated_at ?? null,
        pinResetRequired: setting?.pin_reset_required ?? true,
        failedAttemptCount: setting?.failed_attempt_count ?? 0,
        lockedUntil: setting?.locked_until ?? null,
        lastKioskUseAt: lastKioskUseByStaff.get(row.id) ?? null,
      };
    }),
    events: buildManagerClockHistory(eventRows, correctionRows, accountNames),
  };
}
