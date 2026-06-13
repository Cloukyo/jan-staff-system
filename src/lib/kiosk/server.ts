import { createClient } from "@supabase/supabase-js";
import { getAppMode } from "@/lib/app-mode";
import { getSupabaseConfig, hasSupabaseConfig } from "@/lib/auth/config";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { getKioskDeviceToken } from "@/lib/kiosk/device-session";
import type { KioskRosterEntry } from "@/lib/kiosk/types";

type KioskRosterRow = {
  staff_id: string;
  display_name: string;
  full_name: string;
  employment_role: string;
  current_status: "clocked_in" | "clocked_out";
  pin_ready: boolean;
};

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
  if (!deviceToken) throw new Error("Kiosk device access has not been activated.");
  const supabase = createPublicKioskClient();
  const { data, error } = await supabase.rpc("get_device_kiosk_roster", { device_token: deviceToken });
  if (error) throw new Error(`The production kiosk roster could not be loaded: ${error.message}`);
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
};

export async function loadKioskDevices(): Promise<KioskDeviceRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("kiosk_devices")
    .select("id,device_name,active,expires_at,last_used_at,activated_at,revoked_at")
    .order("activated_at", { ascending: false });
  if (error) throw new Error("Kiosk devices could not be loaded.");
  return (data ?? []).map((row) => ({
    id: row.id,
    deviceName: row.device_name,
    active: row.active,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    activatedAt: row.activated_at,
    revokedAt: row.revoked_at,
  }));
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
  const [profiles, settings, events] = await Promise.all([
    supabase.from("staff_profiles").select("id,display_name,full_name,employment_role,active").order("full_name"),
    supabase.from("staff_kiosk_settings").select("staff_id,kiosk_enabled,pin_updated_at,pin_reset_required,failed_attempt_count,locked_until"),
    supabase.from("clock_events").select("id,staff_id,event_type,event_timestamp,recorded_date,event_source,manager_correction,correction_reason").order("event_timestamp", { ascending: false }).limit(250),
  ]);
  if (profiles.error || settings.error || events.error) throw new Error("Production attendance could not be loaded.");
  const settingMap = new Map((settings.data ?? []).map((row) => [row.staff_id, row]));
  const eventRows = (events.data ?? []) as Array<Record<string, unknown>>;
  const latestByStaff = new Map<string, string>();
  const lastKioskUseByStaff = new Map<string, string>();
  for (const event of eventRows) if (!latestByStaff.has(String(event.staff_id))) latestByStaff.set(String(event.staff_id), String(event.event_type));
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
        currentStatus: latestByStaff.get(row.id) === "clock_in" ? "clocked_in" : "clocked_out",
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
      id: String(row.id),
      staffId: String(row.staff_id),
      eventType: String(row.event_type) as "clock_in" | "clock_out",
      eventTimestamp: String(row.event_timestamp),
      recordedDate: String(row.recorded_date),
      eventSource: String(row.event_source) as "kiosk" | "manager",
      managerCorrection: Boolean(row.manager_correction),
      correctionReason: row.correction_reason ? String(row.correction_reason) : null,
    })),
  };
}
