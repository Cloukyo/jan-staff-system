import { addDays, differenceInMinutes, isValid, parseISO } from "date-fns";
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

export type StaffAttendanceDay = {
  date: string;
  firstClockIn: string | null;
  finalClockOut: string | null;
  totalMinutes: number;
  missingClockOut: boolean;
  hasManagerCorrection: boolean;
  events: StaffAttendanceEvent[];
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

export function summariseAttendanceDay(date: string, events: StaffAttendanceEvent[]): StaffAttendanceDay {
  let openClockIn: Date | null = null;
  let totalMinutes = 0;
  let firstClockIn: string | null = null;
  let finalClockOut: string | null = null;

  for (const event of events) {
    if (event.eventType === "clock_in") {
      if (!firstClockIn) firstClockIn = event.eventTimestamp;
      openClockIn = parseISO(event.eventTimestamp);
    } else {
      finalClockOut = event.eventTimestamp;
      if (openClockIn) {
        totalMinutes += Math.max(0, differenceInMinutes(parseISO(event.eventTimestamp), openClockIn));
        openClockIn = null;
      }
    }
  }

  return {
    date,
    firstClockIn,
    finalClockOut,
    totalMinutes,
    missingClockOut: openClockIn !== null,
    hasManagerCorrection: events.some((event) => event.managerCorrection),
    events,
  };
}

export async function loadStaffAttendance(fromValue?: string, toValue?: string): Promise<StaffAttendanceRange> {
  const account = await requireAccount(["staff"]);
  const range = normaliseDateRange(fromValue, toValue);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("clock_events")
    .select("id,event_type,event_timestamp,recorded_date,manager_correction")
    .eq("staff_id", account.staffId)
    .gte("recorded_date", range.from)
    .lte("recorded_date", range.to)
    .order("event_timestamp");
  if (error) throw new Error("Your attendance could not be loaded.");

  const grouped = new Map<string, StaffAttendanceEvent[]>();
  for (const row of data ?? []) {
    const day = grouped.get(row.recorded_date) ?? [];
    day.push({
      id: row.id,
      eventType: row.event_type,
      eventTimestamp: row.event_timestamp,
      managerCorrection: row.manager_correction,
    });
    grouped.set(row.recorded_date, day);
  }

  return {
    ...range,
    days: [...grouped.entries()]
      .map(([date, events]) => summariseAttendanceDay(date, events))
      .sort((a, b) => b.date.localeCompare(a.date)),
  };
}
