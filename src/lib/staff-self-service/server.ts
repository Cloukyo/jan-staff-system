import { addDays, differenceInMinutes, isValid, parseISO } from "date-fns";
import { createClient } from "@supabase/supabase-js";
import { resolveEffectiveEvents } from "@/lib/attendance/effective-events";
import {
  toAttendanceCorrection,
  toOriginalClockEvent,
  type ClockCorrectionResolverSourceRow,
  type ClockEventSourceRow,
} from "@/lib/attendance/staff-hours";
import { analyseAttendanceDay } from "@/lib/attendance/sequence";
import { getSupabaseConfig } from "@/lib/auth/config";
import { requireAccount } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { isoDate, isoDateInLondon, weekStart } from "@/lib/dates/format";

export type StaffRotaShift = {
  id: string;
  shiftDate: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  breakUnspecified: boolean;
  roomOrArea: string | null;
  roleOnShift: string | null;
  status: "scheduled" | "completed";
};

export type StaffApprovedLeave = {
  id: string;
  startDate: string;
  endDate: string;
  dayPart: "full_day" | "partial_day";
  startTime: string | null;
  endTime: string | null;
};

export type StaffRotaWeek = {
  weekStart: string;
  weekEnd: string;
  publishedAt: string | null;
  shifts: StaffRotaShift[];
  leave: StaffApprovedLeave[];
};

export type StaffAttendanceEvent = {
  id: string;
  eventType: "clock_in" | "clock_out";
  eventTimestamp: string;
  managerCorrection: boolean;
};

export type StaffAttendanceCorrection = {
  id: string;
  eventType: "clock_in" | "clock_out" | null;
  eventTimestamp: string | null;
  sourceLabel: "Manager correction";
  status: "active" | "superseded";
};

export type StaffAttendanceDay = {
  date: string;
  firstClockIn: string | null;
  finalClockOut: string | null;
  totalMinutes: number;
  missingClockOut: boolean;
  hasManagerCorrection: boolean;
  events: StaffAttendanceEvent[];
  originalEvents: StaffAttendanceEvent[];
  corrections: StaffAttendanceCorrection[];
};

export type StaffAttendanceRange = {
  from: string;
  to: string;
  days: StaffAttendanceDay[];
};

export function normaliseWeekStart(value?: string): string {
  const parsed = value ? parseISO(value) : parseISO(isoDateInLondon());
  return isoDate(weekStart(isValid(parsed) ? parsed : parseISO(isoDateInLondon())));
}

function normaliseDateRange(fromValue?: string, toValue?: string): { from: string; to: string } {
  const today = parseISO(isoDateInLondon());
  const fallbackFrom = weekStart(today);
  const parsedFrom = fromValue ? parseISO(fromValue) : fallbackFrom;
  const parsedTo = toValue ? parseISO(toValue) : today;
  const from = isValid(parsedFrom) ? parsedFrom : fallbackFrom;
  const to = isValid(parsedTo) && parsedTo >= from ? parsedTo : today;
  const cappedTo = differenceInMinutes(to, from) > 93 * 24 * 60 ? addDays(from, 93) : to;
  return { from: isoDate(from), to: isoDate(cappedTo) };
}

export async function loadStaffRotaWeek(weekValue?: string): Promise<StaffRotaWeek> {
  const account = await requireAccount(["staff"]);
  const weekStartDate = normaliseWeekStart(weekValue);
  const weekEnd = isoDate(addDays(parseISO(weekStartDate), 6));
  const supabase = await createSupabaseServerClient();
  const [weekResult, leaveResult] = await Promise.all([
    supabase.from("rota_weeks").select("id,published_at").eq("week_start_date", weekStartDate).eq("status", "published").maybeSingle(),
    supabase.from("leave_requests").select("id,start_date,end_date,day_part,start_time,end_time")
      .eq("staff_id", account.staffId).eq("status", "approved").lte("start_date", weekEnd).gte("end_date", weekStartDate),
  ]);
  if (weekResult.error || leaveResult.error) throw new Error("Your rota could not be loaded.");

  let shifts: StaffRotaShift[] = [];
  if (weekResult.data) {
    const shiftResult = await supabase.from("rota_shifts")
      .select("id,shift_date,start_time,end_time,break_minutes,break_unspecified,room_or_area,role_on_shift,status")
      .eq("rota_week_id", weekResult.data.id)
      .eq("staff_id", account.staffId)
      .is("archived_at", null)
      .in("status", ["scheduled", "completed"])
      .order("shift_date")
      .order("start_time");
    if (shiftResult.error) throw new Error("Your rota shifts could not be loaded.");
    shifts = (shiftResult.data ?? []).map((row) => ({
      id: row.id,
      shiftDate: row.shift_date,
      startTime: String(row.start_time).slice(0, 5),
      endTime: String(row.end_time).slice(0, 5),
      breakMinutes: row.break_minutes,
      breakUnspecified: row.break_unspecified,
      roomOrArea: row.room_or_area,
      roleOnShift: row.role_on_shift,
      status: row.status,
    }));
  }

  return {
    weekStart: weekStartDate,
    weekEnd,
    publishedAt: weekResult.data?.published_at ?? null,
    shifts,
    leave: (leaveResult.data ?? []).map((row) => ({
      id: row.id,
      startDate: row.start_date,
      endDate: row.end_date,
      dayPart: row.day_part,
      startTime: row.start_time ? String(row.start_time).slice(0, 5) : null,
      endTime: row.end_time ? String(row.end_time).slice(0, 5) : null,
    })),
  };
}

export function summariseAttendanceDay(
  date: string,
  events: StaffAttendanceEvent[],
  originalEvents: StaffAttendanceEvent[] = events,
  corrections: StaffAttendanceCorrection[] = [],
): StaffAttendanceDay {
  const ordered = [...events].sort(
    (left, right) => Date.parse(left.eventTimestamp) - Date.parse(right.eventTimestamp) || left.id.localeCompare(right.id),
  );
  const analysis = analyseAttendanceDay({
    events: ordered.map((event) => ({
      id: event.id,
      staffId: "self",
      eventType: event.eventType,
      eventTimestamp: event.eventTimestamp,
      recordedDate: date,
      source: event.managerCorrection ? "manager_correction" : "kiosk",
      originalEventId: null,
      correctionId: event.managerCorrection ? event.id : null,
    })),
  });
  return {
    date,
    firstClockIn: ordered.find((event) => event.eventType === "clock_in")?.eventTimestamp ?? null,
    finalClockOut: ordered.filter((event) => event.eventType === "clock_out").at(-1)?.eventTimestamp ?? null,
    totalMinutes: analysis.completedMinutes,
    missingClockOut: analysis.hasOpenShift,
    hasManagerCorrection: ordered.some((event) => event.managerCorrection) || corrections.length > 0,
    events: ordered,
    originalEvents,
    corrections,
  };
}

export async function loadStaffAttendance(fromValue?: string, toValue?: string): Promise<StaffAttendanceRange> {
  const account = await requireAccount(["staff"]);
  const range = normaliseDateRange(fromValue, toValue);
  const supabase = await createSupabaseServerClient();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) throw new Error("Your attendance could not be loaded.");
  const admin = createClient(getSupabaseConfig().url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const [originals, corrections] = await Promise.all([
    supabase.from("clock_events")
      .select("id,staff_id,event_type,event_timestamp,recorded_date,event_source,manager_correction,correction_reason")
      .eq("staff_id", account.staffId)
      .gte("recorded_date", range.from)
      .lte("recorded_date", range.to)
      .order("event_timestamp"),
    admin.from("clock_event_corrections")
      .select("id,staff_id,correction_kind,original_event_id,supersedes_correction_id,event_type,event_timestamp,recorded_date,created_at")
      .eq("staff_id", account.staffId)
      .gte("recorded_date", range.from)
      .lte("recorded_date", range.to)
      .order("created_at"),
  ]);
  if (originals.error || corrections.error) throw new Error("Your attendance could not be loaded.");

  const originalRows = (originals.data ?? []) as ClockEventSourceRow[];
  const correctionRows = (corrections.data ?? []) as ClockCorrectionResolverSourceRow[];
  const resolved = resolveEffectiveEvents(
    originalRows.map(toOriginalClockEvent),
    correctionRows.map(toAttendanceCorrection),
  );
  const correctionById = new Map(correctionRows.map((row) => [row.id, row]));
  const dates = new Set([
    ...originalRows.map((row) => row.recorded_date),
    ...correctionRows.map((row) => row.recorded_date),
    ...resolved.effective.map((event) => event.recordedDate),
  ]);

  return {
    ...range,
    days: [...dates]
      .map((date) => summariseAttendanceDay(
        date,
        resolved.effective
          .filter((event) => event.recordedDate === date)
          .map((event) => ({
            id: event.id,
            eventType: event.eventType,
            eventTimestamp: event.eventTimestamp,
            managerCorrection: event.source !== "kiosk",
          })),
        originalRows
          .filter((row) => row.recorded_date === date)
          .map((row) => ({
            id: row.id,
            eventType: row.event_type,
            eventTimestamp: row.event_timestamp,
            managerCorrection: row.event_source === "manager" || row.manager_correction,
          })),
        resolved.audit.corrections
          .filter((audit) => correctionById.get(audit.correctionId)?.recorded_date === date)
          .map((audit) => {
            const row = correctionById.get(audit.correctionId)!;
            return {
              id: row.id,
              eventType: row.event_type,
              eventTimestamp: row.event_timestamp,
              sourceLabel: "Manager correction",
              status: audit.status,
            };
          }),
      ))
      .sort((a, b) => b.date.localeCompare(a.date)),
  };
}
