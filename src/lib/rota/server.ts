import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import type { AppMode } from "@/lib/app-mode";
import type { ProductionRotaDataset, ProductionRotaShift, ProductionRotaWeek, RotaLeaveWarning } from "@/lib/rota/types";

export function rotaRepositorySource(mode: AppMode): "demo" | "supabase" {
  return mode === "demo" ? "demo" : "supabase";
}

function mapWeek(row: Record<string, unknown>): ProductionRotaWeek {
  return {
    id: String(row.id),
    weekStartDate: String(row.week_start_date),
    status: String(row.status) as ProductionRotaWeek["status"],
    title: row.title ? String(row.title) : null,
    notes: row.notes ? String(row.notes) : null,
    publishedAt: row.published_at ? String(row.published_at) : null,
    archivedAt: row.archived_at ? String(row.archived_at) : null,
  };
}

function mapShift(row: Record<string, unknown>): ProductionRotaShift {
  return {
    id: String(row.id),
    rotaWeekId: String(row.rota_week_id),
    staffId: String(row.staff_id),
    shiftDate: String(row.shift_date),
    startTime: String(row.start_time).slice(0, 5),
    endTime: String(row.end_time).slice(0, 5),
    breakMinutes: Number(row.break_minutes),
    roomOrArea: row.room_or_area ? String(row.room_or_area) : null,
    roleOnShift: row.role_on_shift ? String(row.role_on_shift) : null,
    notes: row.notes ? String(row.notes) : null,
    status: String(row.status) as ProductionRotaShift["status"],
    inactiveStaffOverrideReason: row.inactive_staff_override_reason ? String(row.inactive_staff_override_reason) : null,
    leaveOverrideReason: row.leave_override_reason ? String(row.leave_override_reason) : null,
    overlapOverrideReason: row.overlap_override_reason ? String(row.overlap_override_reason) : null,
    archivedAt: row.archived_at ? String(row.archived_at) : null,
  };
}

export async function loadProductionRota(weekStart: string): Promise<ProductionRotaDataset> {
  const supabase = await createSupabaseServerClient();
  const weekEnd = new Date(`${weekStart}T12:00:00Z`);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  const end = weekEnd.toISOString().slice(0, 10);
  const [weekResult, staffResult, leaveResult, settingsResult] = await Promise.all([
    supabase.from("rota_weeks").select("*").eq("week_start_date", weekStart).neq("status", "archived").maybeSingle(),
    supabase.from("staff_profiles").select("id,full_name,display_name,employment_role,active").order("full_name"),
    supabase.from("leave_requests").select("id,staff_id,start_date,end_date,day_part,start_time,end_time,status")
      .in("status", ["pending", "approved"]).lte("start_date", end).gte("end_date", weekStart),
    supabase.from("rota_settings").select("*").eq("id", true).single(),
  ]);
  if (weekResult.error || staffResult.error || leaveResult.error || settingsResult.error) {
    throw new Error("Production rota data could not be loaded.");
  }
  const week = weekResult.data ? mapWeek(weekResult.data as Record<string, unknown>) : null;
  let shifts: ProductionRotaShift[] = [];
  if (week) {
    const result = await supabase.from("rota_shifts").select("*").eq("rota_week_id", week.id).is("archived_at", null).order("shift_date").order("start_time");
    if (result.error) throw new Error("Production rota shifts could not be loaded.");
    shifts = (result.data as Record<string, unknown>[]).map(mapShift);
  }
  const settings = settingsResult.data;
  return {
    weekStart,
    week,
    shifts,
    staff: staffResult.data.map((row) => ({
      id: row.id,
      fullName: row.full_name,
      displayName: row.display_name,
      employmentRole: row.employment_role,
      active: row.active,
    })),
    leave: leaveResult.data.map((row) => ({
      id: row.id,
      staffId: row.staff_id,
      startDate: row.start_date,
      endDate: row.end_date,
      dayPart: row.day_part,
      startTime: row.start_time,
      endTime: row.end_time,
      status: row.status,
    })) as RotaLeaveWarning[],
    settings: {
      openingTime: String(settings.opening_time).slice(0, 5),
      closingTime: String(settings.closing_time).slice(0, 5),
      defaultBreakMinutes: settings.default_break_minutes,
      shiftIntervalMinutes: settings.shift_interval_minutes,
      availableRooms: settings.available_rooms ?? [],
      allowOverlapOverride: settings.allow_overlap_override,
      allowInactiveStaffOverride: settings.allow_inactive_staff_override,
    },
  };
}
