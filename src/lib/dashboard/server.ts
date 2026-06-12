import type { AppMode } from "@/lib/app-mode";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import type { DashboardRotaStatus, ProductionDashboardSummary } from "@/lib/dashboard/types";

export function dashboardRepositorySource(mode: AppMode): "demo" | "supabase" {
  return mode === "demo" ? "demo" : "supabase";
}

function numberValue(row: Record<string, unknown>, key: string): number {
  return Number(row[key] ?? 0);
}

export function mapDashboardSummary(row: Record<string, unknown>): ProductionDashboardSummary {
  const currentRota = row.current_rota as Record<string, unknown> | null;
  return {
    referenceDate: String(row.reference_date),
    weekStartDate: String(row.week_start_date),
    activeStaff: numberValue(row, "active_staff"),
    currentlyClockedIn: numberValue(row, "currently_clocked_in"),
    todayScheduledShifts: numberValue(row, "today_scheduled_shifts"),
    todayAttendanceExceptions: numberValue(row, "today_attendance_exceptions"),
    missingClockOuts: numberValue(row, "missing_clock_outs"),
    pendingLeaveRequests: numberValue(row, "pending_leave_requests"),
    approvedLeaveRotaConflicts: numberValue(row, "approved_leave_rota_conflicts"),
    expiredCertificates: numberValue(row, "expired_certificates"),
    certificatesExpiring30Days: numberValue(row, "certificates_expiring_30_days"),
    incompleteCentralRecords: numberValue(row, "incomplete_central_records"),
    staffMissingKioskPin: numberValue(row, "staff_missing_kiosk_pin"),
    staffMissingPayArrangement: numberValue(row, "staff_missing_pay_arrangement"),
    currentRota: currentRota?.id ? {
      id: String(currentRota.id),
      status: String(currentRota.status) as DashboardRotaStatus,
      weekStartDate: String(currentRota.week_start_date),
      publishedAt: currentRota.published_at ? String(currentRota.published_at) : null,
    } : null,
    clockedInStaff: ((row.clocked_in_staff ?? []) as Record<string, unknown>[]).map((item) => ({
      staffId: String(item.staff_id),
      displayName: String(item.display_name),
      clockedInAt: String(item.clocked_in_at),
      scheduledEnd: item.scheduled_end ? String(item.scheduled_end).slice(0, 5) : null,
    })),
    attendanceWarnings: ((row.attendance_warnings ?? []) as Record<string, unknown>[]).map((item) => ({
      staffId: String(item.staff_id),
      displayName: String(item.display_name),
      warning: String(item.warning),
      warningDate: String(item.warning_date),
    })),
    upcomingShifts: ((row.upcoming_shifts ?? []) as Record<string, unknown>[]).map((item) => ({
      id: String(item.id),
      shiftDate: String(item.shift_date),
      displayName: String(item.display_name),
      startTime: String(item.start_time).slice(0, 5),
      endTime: String(item.end_time).slice(0, 5),
      roomOrArea: item.room_or_area ? String(item.room_or_area) : null,
      roleOnShift: item.role_on_shift ? String(item.role_on_shift) : null,
      rotaStatus: String(item.rota_status) as ProductionDashboardSummary["upcomingShifts"][number]["rotaStatus"],
    })),
  };
}

export async function loadProductionDashboard(referenceDate: string): Promise<ProductionDashboardSummary> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_manager_dashboard_summary", { reference_date: referenceDate });
  if (error || !data || Array.isArray(data) || typeof data !== "object") {
    throw new Error("Live dashboard data could not be loaded from Supabase.");
  }
  return mapDashboardSummary(data as Record<string, unknown>);
}
