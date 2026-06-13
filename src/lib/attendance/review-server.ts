import { requireAccount } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { isoDateInLondon } from "@/lib/dates/format";

export type AttendanceReviewStatus = "unreviewed" | "approved" | "corrected" | "ignored" | "needs_staff_clarification";

export type AttendanceReviewRow = {
  staffId: string;
  fullName: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  firstClockIn: string | null;
  finalClockOut: string | null;
  recordedMinutes: number;
  exceptions: string[];
  managerCorrection: boolean;
  reviewStatus: AttendanceReviewStatus;
  reviewReason: string | null;
  reviewedAt: string | null;
  pendingClarificationCount: number;
  pendingClarifications: Array<{ id: string; issueType: string; staffNote: string }>;
};

export type AttendanceReviewDay = {
  date: string;
  rows: AttendanceReviewRow[];
  counts: {
    scheduled: number;
    clockedIn: number;
    exceptions: number;
    unreviewed: number;
    clarificationRequests: number;
  };
};

type ClockRow = {
  staff_id: string;
  event_type: "clock_in" | "clock_out";
  event_timestamp: string;
  manager_correction: boolean;
};

function timeMinutes(value: string | null): number | null {
  if (!value) return null;
  const [hours, minutes] = value.slice(0, 5).split(":").map(Number);
  return hours * 60 + minutes;
}

function eventTimeMinutes(value: string | null): number | null {
  if (!value) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/London",
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(values.hour) * 60 + Number(values.minute);
}

export function buildAttendanceReviewRow(input: {
  staffId: string;
  fullName: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  events: ClockRow[];
  review?: { status: Exclude<AttendanceReviewStatus, "unreviewed">; reason: string | null; reviewed_at: string } | null;
  pendingClarifications?: Array<{ id: string; issueType: string; staffNote: string }>;
}): AttendanceReviewRow {
  const ordered = [...input.events].sort((a, b) => a.event_timestamp.localeCompare(b.event_timestamp));
  const clockIns = ordered.filter((event) => event.event_type === "clock_in");
  const clockOuts = ordered.filter((event) => event.event_type === "clock_out");
  const firstClockIn = clockIns[0]?.event_timestamp ?? null;
  const finalClockOut = clockOuts.at(-1)?.event_timestamp ?? null;
  const exceptions: string[] = [];
  if (input.scheduledStart && !firstClockIn) exceptions.push("Missing clock-in");
  if (firstClockIn && !finalClockOut) exceptions.push("Missing clock-out");
  if (!input.scheduledStart && firstClockIn) exceptions.push("Clock-in without rota shift");
  if (clockIns.length > 1 || clockOuts.length > 1) exceptions.push("Overlapping or duplicate events");

  const scheduledStart = timeMinutes(input.scheduledStart);
  const scheduledEnd = timeMinutes(input.scheduledEnd);
  const actualStart = eventTimeMinutes(firstClockIn);
  const actualEnd = eventTimeMinutes(finalClockOut);
  if (scheduledStart !== null && actualStart !== null && actualStart - scheduledStart > 5) exceptions.push("Late arrival");
  if (scheduledEnd !== null && actualEnd !== null && scheduledEnd - actualEnd > 0) exceptions.push("Early departure");

  let recordedMinutes = 0;
  let open: Date | null = null;
  for (const event of ordered) {
    if (event.event_type === "clock_in") {
      open = new Date(event.event_timestamp);
    } else if (open) {
      recordedMinutes += Math.max(0, Math.round((new Date(event.event_timestamp).getTime() - open.getTime()) / 60000));
      open = null;
    }
  }
  if (scheduledStart !== null && scheduledEnd !== null && recordedMinutes - (scheduledEnd - scheduledStart) > 15) {
    exceptions.push("Overtime or extended shift");
  }

  return {
    staffId: input.staffId,
    fullName: input.fullName,
    scheduledStart: input.scheduledStart,
    scheduledEnd: input.scheduledEnd,
    firstClockIn,
    finalClockOut,
    recordedMinutes,
    exceptions: Array.from(new Set(exceptions)),
    managerCorrection: ordered.some((event) => event.manager_correction),
    reviewStatus: input.review?.status ?? "unreviewed",
    reviewReason: input.review?.reason ?? null,
    reviewedAt: input.review?.reviewed_at ?? null,
    pendingClarificationCount: input.pendingClarifications?.length ?? 0,
    pendingClarifications: input.pendingClarifications ?? [],
  };
}

export async function loadAttendanceReviewDay(dateValue?: string): Promise<AttendanceReviewDay> {
  await requireAccount(["manager"]);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateValue ?? "") ? dateValue! : isoDateInLondon();
  const supabase = await createSupabaseServerClient();
  const [profiles, shifts, events, reviews, requests] = await Promise.all([
    supabase.from("staff_profiles").select("id,full_name,active").eq("active", true).order("full_name"),
    supabase.from("rota_shifts").select("staff_id,start_time,end_time,status,rota_weeks!inner(status)")
      .eq("shift_date", date).is("archived_at", null).neq("status", "cancelled").eq("rota_weeks.status", "published"),
    supabase.from("clock_events").select("staff_id,event_type,event_timestamp,manager_correction").eq("recorded_date", date).order("event_timestamp"),
    supabase.from("attendance_day_reviews").select("staff_id,status,reason,reviewed_at").eq("review_date", date),
    supabase.from("attendance_correction_requests").select("id,staff_id,issue_type,staff_note,status").eq("attendance_date", date).eq("status", "pending"),
  ]);
  if (profiles.error || shifts.error || events.error || reviews.error || requests.error) {
    throw new Error("Attendance review data could not be loaded.");
  }

  const shiftByStaff = new Map((shifts.data ?? []).map((row) => [row.staff_id, row]));
  const reviewByStaff = new Map((reviews.data ?? []).map((row) => [row.staff_id, row]));
  const eventsByStaff = new Map<string, ClockRow[]>();
  for (const event of (events.data ?? []) as ClockRow[]) {
    const list = eventsByStaff.get(event.staff_id) ?? [];
    list.push(event);
    eventsByStaff.set(event.staff_id, list);
  }
  const requestsByStaff = new Map<string, Array<{ id: string; issueType: string; staffNote: string }>>();
  for (const request of requests.data ?? []) {
    const list = requestsByStaff.get(request.staff_id) ?? [];
    list.push({ id: request.id, issueType: request.issue_type, staffNote: request.staff_note });
    requestsByStaff.set(request.staff_id, list);
  }

  const rows = (profiles.data ?? [])
    .filter((profile) => shiftByStaff.has(profile.id) || eventsByStaff.has(profile.id) || requestsByStaff.has(profile.id))
    .map((profile) => {
      const shift = shiftByStaff.get(profile.id);
      return buildAttendanceReviewRow({
        staffId: profile.id,
        fullName: profile.full_name,
        scheduledStart: shift ? String(shift.start_time).slice(0, 5) : null,
        scheduledEnd: shift ? String(shift.end_time).slice(0, 5) : null,
        events: eventsByStaff.get(profile.id) ?? [],
        review: reviewByStaff.get(profile.id) ?? null,
        pendingClarifications: requestsByStaff.get(profile.id) ?? [],
      });
    });

  return {
    date,
    rows,
    counts: {
      scheduled: rows.filter((row) => row.scheduledStart).length,
      clockedIn: rows.filter((row) => row.firstClockIn).length,
      exceptions: rows.filter((row) => row.exceptions.length).length,
      unreviewed: rows.filter((row) => row.reviewStatus === "unreviewed").length,
      clarificationRequests: rows.reduce((total, row) => total + row.pendingClarificationCount, 0),
    },
  };
}

export async function loadAttendanceReviewReadiness(from: string, to: string): Promise<{ unresolved: number; pendingRequests: number }> {
  await requireAccount(["manager"]);
  const supabase = await createSupabaseServerClient();
  const [reviews, requests, eventDays] = await Promise.all([
    supabase.from("attendance_day_reviews").select("staff_id,review_date,status").gte("review_date", from).lte("review_date", to),
    supabase.from("attendance_correction_requests").select("id").eq("status", "pending").gte("attendance_date", from).lte("attendance_date", to),
    supabase.from("clock_events").select("staff_id,recorded_date").gte("recorded_date", from).lte("recorded_date", to),
  ]);
  if (reviews.error || requests.error || eventDays.error) throw new Error("Attendance review readiness could not be loaded.");
  const reviewed = new Set((reviews.data ?? []).map((row) => `${row.staff_id}:${row.review_date}`));
  const workedDays = new Set((eventDays.data ?? []).map((row) => `${row.staff_id}:${row.recorded_date}`));
  return {
    unresolved: [...workedDays].filter((key) => !reviewed.has(key)).length,
    pendingRequests: requests.data?.length ?? 0,
  };
}
