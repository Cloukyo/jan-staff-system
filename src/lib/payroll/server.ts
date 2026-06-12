import { addDays, format, parseISO } from "date-fns";
import { getAppMode } from "@/lib/app-mode";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { londonDateStartUtc } from "@/lib/dates/format";
import type { PayArrangement, ProductionClockEvent, ProductionStaffRow } from "@/lib/payroll/types";

export function payrollRepositorySource(mode = getAppMode()): "demo" | "supabase" {
  return mode === "demo" ? "demo" : "supabase";
}

function arrangement(row: Record<string, unknown>): PayArrangement {
  return {
    id: String(row.id),
    staffId: String(row.staff_id),
    payType: String(row.pay_type) as PayArrangement["payType"],
    hourlyRate: row.hourly_rate === null ? null : Number(row.hourly_rate),
    annualSalary: row.annual_salary === null ? null : Number(row.annual_salary),
    monthlySalary: row.monthly_salary === null ? null : Number(row.monthly_salary),
    contractedWeeklyHours: Number(row.contracted_weekly_hours),
    standardDailyHours: row.standard_daily_hours === null ? null : Number(row.standard_daily_hours),
    overtimeMultiplier: Number(row.overtime_multiplier),
    effectiveFrom: String(row.effective_from),
    effectiveTo: row.effective_to ? String(row.effective_to) : null,
    isActive: Boolean(row.is_active),
    managerNotes: row.manager_notes ? String(row.manager_notes) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function loadProductionStaffRows(): Promise<ProductionStaffRow[]> {
  const supabase = await createSupabaseServerClient();
  const [profiles, accounts, kiosk, arrangements] = await Promise.all([
    supabase.from("staff_profiles").select("id,full_name,display_name,employment_role,main_qualification_level,active").order("full_name"),
    supabase.from("staff_accounts").select("staff_id,auth_user_id,active,role"),
    supabase.from("staff_kiosk_settings").select("staff_id,kiosk_enabled,pin_updated_at,pin_reset_required"),
    supabase.from("staff_pay_arrangements").select("*").order("effective_from", { ascending: false }),
  ]);
  if (profiles.error || accounts.error || kiosk.error || arrangements.error) throw new Error("Production staff and pay records could not be loaded.");
  const accountsByStaff = new Map((accounts.data ?? []).map((row) => [row.staff_id, row]));
  const kioskByStaff = new Map((kiosk.data ?? []).map((row) => [row.staff_id, row]));
  const payRows = ((arrangements.data ?? []) as Record<string, unknown>[]).map(arrangement);
  return (profiles.data ?? []).map((profile) => {
    const account = accountsByStaff.get(profile.id);
    const kioskSetting = kioskByStaff.get(profile.id);
    return {
      id: profile.id,
      fullName: profile.full_name,
      displayName: profile.display_name,
      employmentRole: profile.employment_role,
      mainQualificationLevel: profile.main_qualification_level,
      active: profile.active,
      loginStatus: account?.active && account?.auth_user_id ? "Active login" : account ? "Login not linked" : "No login",
      kioskStatus: kioskSetting?.kiosk_enabled ? (kioskSetting.pin_updated_at && !kioskSetting.pin_reset_required ? "Enabled" : "PIN setup needed") : "Disabled",
      isManager: account?.role === "manager",
      payArrangements: payRows.filter((item) => item.staffId === profile.id),
    };
  });
}

export async function loadProductionClockEvents(periodStart: string, periodEnd: string): Promise<ProductionClockEvent[]> {
  const supabase = await createSupabaseServerClient();
  const start = londonDateStartUtc(periodStart).toISOString();
  const dayAfterEnd = format(addDays(parseISO(periodEnd), 1), "yyyy-MM-dd");
  const end = londonDateStartUtc(dayAfterEnd).toISOString();
  const { data, error } = await supabase.from("clock_events")
    .select("id,staff_id,event_type,event_timestamp,manager_correction")
    .gte("event_timestamp", start).lt("event_timestamp", end)
    .order("event_timestamp");
  if (error) throw new Error("Production clock events could not be loaded.");
  return (data ?? []).map((row) => ({
    id: row.id,
    staffId: row.staff_id,
    eventType: row.event_type,
    eventTimestamp: row.event_timestamp,
    managerCorrection: row.manager_correction,
  }));
}
