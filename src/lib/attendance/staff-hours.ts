import { requireAccount } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import {
  resolveEffectiveEvents,
  type AttendanceCorrection,
  type AttendanceCorrectionKind,
  type AttendanceEventType,
  type EffectiveClockEvent,
  type OriginalClockEvent,
} from "@/lib/attendance/effective-events";
import {
  analyseAttendanceDay,
  type AttendanceSession,
  type AttendanceWarning,
} from "@/lib/attendance/sequence";
import { ATTENDANCE_RANGE_MAX_DAYS } from "@/lib/attendance/date-range";
import { isoDateInLondon } from "@/lib/dates/format";
import { loadAllPostgrestPages } from "@/lib/repositories/postgrest-pagination";

export const STAFF_HOURS_MAX_RANGE_DAYS = ATTENDANCE_RANGE_MAX_DAYS;
export { loadAllPostgrestPages as loadAllPages };

export type StaffHoursProfileSourceRow = {
  id: string;
  display_name: string;
  full_name: string;
};

export type StaffHoursShiftSourceRow = {
  id: string;
  staff_id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  break_minutes: number;
};

export type ClockEventSourceRow = {
  id: string;
  staff_id: string;
  event_type: AttendanceEventType;
  event_timestamp: string;
  recorded_date: string;
  event_source: "kiosk" | "manager";
  manager_correction: boolean;
  correction_reason: string | null;
};

export type ClockCorrectionResolverSourceRow = {
  id: string;
  staff_id: string;
  correction_kind: AttendanceCorrectionKind;
  original_event_id: string | null;
  supersedes_correction_id: string | null;
  event_type: AttendanceEventType | null;
  event_timestamp: string | null;
  recorded_date: string;
  created_at: string;
};

export type ClockCorrectionSourceRow = ClockCorrectionResolverSourceRow & {
  batch_id: string;
  correction_role: "primary" | "consequential";
  reason: string;
  created_by: string;
};

export type StaffHoursReviewStatus =
  | "approved"
  | "corrected"
  | "ignored"
  | "needs_staff_clarification";

export type StaffHoursReviewSourceRow = {
  staff_id: string;
  review_date: string;
  status: StaffHoursReviewStatus;
  reason: string | null;
  reviewed_at: string;
};

export type StaffHoursTotalSourceRow = {
  staff_id: string;
  completed_minutes: number | null;
  open_shift_count: number | null;
};

export type StaffHoursPlannedPeriod = {
  id: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
};

export type StaffHoursOriginalAudit = {
  id: string;
  staffId: string;
  eventType: AttendanceEventType;
  eventTimestamp: string;
  recordedDate: string;
  sourceLabel: "Kiosk" | "Legacy manager event";
  managerCorrection: boolean;
  correctionReason: string | null;
  status: "active" | "replaced" | "excluded";
  correctionId: string | null;
};

export type StaffHoursCorrectionAudit = {
  id: string;
  batchId: string;
  correctionRole: "primary" | "consequential";
  staffId: string;
  kind: AttendanceCorrectionKind;
  originalEventId: string | null;
  supersedesCorrectionId: string | null;
  eventType: AttendanceEventType | null;
  eventTimestamp: string | null;
  recordedDate: string;
  reason: string;
  createdBy: string;
  createdAt: string;
  sourceLabel: "Manager correction";
  status: "active" | "superseded";
};

export type StaffHoursReview = {
  status: StaffHoursReviewStatus;
  reason: string | null;
  reviewedAt: string;
};

export type StaffHoursDay = {
  staffId: string;
  displayName: string;
  fullName: string;
  date: string;
  plannedPeriods: StaffHoursPlannedPeriod[];
  audit: {
    originals: StaffHoursOriginalAudit[];
    corrections: StaffHoursCorrectionAudit[];
  };
  effectiveEvents: EffectiveClockEvent[];
  sessions: AttendanceSession[];
  completedMinutes: number;
  hasOpenShift: boolean;
  warnings: AttendanceWarning[];
  suggestedMissingType: AttendanceEventType;
  review: StaffHoursReview | null;
};

export type StaffHoursListRow = {
  staffId: string;
  displayName: string;
  fullName: string;
  completedMinutes: number;
  hasOpenShift: boolean;
  daysNeedingAttention: number;
};

export type StaffHoursRange = {
  from: string;
  to: string;
  currentWeekStart: string;
  currentWeekEnd: string;
  staff: StaffHoursListRow[];
  days: StaffHoursDay[];
};

export type StaffHoursList = Omit<StaffHoursRange, "days" | "staff"> & {
  rows: StaffHoursListRow[];
};

export type StaffHoursWeek = Omit<StaffHoursRange, "staff"> & {
  staffId: string;
  displayName: string;
  fullName: string;
};

export type AttendanceDay = {
  date: string;
  rows: StaffHoursDay[];
};

export type StaffHoursRangeSource = {
  from: string;
  to: string;
  currentWeekStart: string;
  currentWeekEnd: string;
  profiles: StaffHoursProfileSourceRow[];
  shifts: StaffHoursShiftSourceRow[];
  originals: ClockEventSourceRow[];
  corrections: ClockCorrectionSourceRow[];
  reviews: StaffHoursReviewSourceRow[];
  totals?: StaffHoursTotalSourceRow[];
};

function validIsoDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

export function parseStaffHoursWeekId(value: string | undefined): string | null {
  const staffId = value?.trim();
  return staffId && staffId.length <= 128 && /^[A-Za-z0-9_-]+$/.test(staffId)
    ? staffId
    : null;
}

function previousIsoDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

function addIsoDateDays(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function clockSource(row: ClockEventSourceRow): OriginalClockEvent["source"] {
  return row.event_source === "manager" || row.manager_correction ? "legacy_manager" : "kiosk";
}

function orderedByTimestamp<T extends { eventTimestamp: string; id: string }>(rows: T[]): T[] {
  return [...rows].sort(
    (left, right) =>
      Date.parse(left.eventTimestamp) - Date.parse(right.eventTimestamp)
      || left.id.localeCompare(right.id),
  );
}

function compareNames(left: { fullName: string }, right: { fullName: string }): number {
  return left.fullName.localeCompare(right.fullName, "en-GB", { sensitivity: "base" });
}

export function previousLondonDate(reference = new Date()): string {
  return previousIsoDate(isoDateInLondon(reference));
}

export function normaliseStaffHoursRange(
  from: string | undefined,
  to: string | undefined,
  currentWeek: { start: string; end: string },
): { from: string; to: string } {
  if (validIsoDate(from) && validIsoDate(to) && from <= to) {
    const maximumEnd = addIsoDateDays(from, STAFF_HOURS_MAX_RANGE_DAYS - 1);
    return { from, to: to < maximumEnd ? to : maximumEnd };
  }
  return { from: currentWeek.start, to: currentWeek.end };
}

export function toOriginalClockEvent(row: ClockEventSourceRow): OriginalClockEvent {
  return {
    id: row.id,
    staffId: row.staff_id,
    eventType: row.event_type,
    eventTimestamp: row.event_timestamp,
    recordedDate: row.recorded_date,
    source: clockSource(row),
  };
}

export function toAttendanceCorrection(row: ClockCorrectionResolverSourceRow): AttendanceCorrection {
  return {
    id: row.id,
    staffId: row.staff_id,
    kind: row.correction_kind,
    originalEventId: row.original_event_id,
    eventType: row.event_type,
    eventTimestamp: row.event_timestamp,
    recordedDate: row.recorded_date,
    supersedesCorrectionId: row.supersedes_correction_id,
    createdAt: row.created_at,
  };
}

function buildStaffDay(
  profile: StaffHoursProfileSourceRow,
  date: string,
  shifts: StaffHoursShiftSourceRow[],
  originalRows: ClockEventSourceRow[],
  correctionRows: ClockCorrectionSourceRow[],
  reviewRow: StaffHoursReviewSourceRow | undefined,
): StaffHoursDay {
  const resolved = resolveEffectiveEvents(
    originalRows.map(toOriginalClockEvent),
    correctionRows.map(toAttendanceCorrection),
  );
  const originalById = new Map(originalRows.map((row) => [row.id, row]));
  const correctionById = new Map(correctionRows.map((row) => [row.id, row]));
  const plannedPeriods = [...shifts]
    .sort((left, right) => left.start_time.localeCompare(right.start_time) || left.id.localeCompare(right.id))
    .map((shift) => ({
      id: shift.id,
      startTime: String(shift.start_time).slice(0, 5),
      endTime: String(shift.end_time).slice(0, 5),
      breakMinutes: Number(shift.break_minutes),
    }));
  const analysis = analyseAttendanceDay({
    events: resolved.effective,
    plannedShift: plannedPeriods.length
      ? {
          start: plannedPeriods[0].startTime,
          end: plannedPeriods.at(-1)!.endTime,
        }
      : null,
  });

  return {
    staffId: profile.id,
    displayName: profile.display_name,
    fullName: profile.full_name,
    date,
    plannedPeriods,
    audit: {
      originals: orderedByTimestamp(resolved.audit.originals.map((audit) => {
        const row = originalById.get(audit.event.id)!;
        return {
          id: row.id,
          staffId: row.staff_id,
          eventType: row.event_type,
          eventTimestamp: row.event_timestamp,
          recordedDate: row.recorded_date,
          sourceLabel: clockSource(row) === "legacy_manager" ? "Legacy manager event" as const : "Kiosk" as const,
          managerCorrection: clockSource(row) === "legacy_manager",
          correctionReason: row.correction_reason,
          status: audit.status,
          correctionId: audit.correctionId,
        };
      })),
      corrections: resolved.audit.corrections
        .map((audit) => {
          const row = correctionById.get(audit.correctionId)!;
          return {
            id: row.id,
            batchId: row.batch_id,
            correctionRole: row.correction_role,
            staffId: row.staff_id,
            kind: row.correction_kind,
            originalEventId: row.original_event_id,
            supersedesCorrectionId: row.supersedes_correction_id,
            eventType: row.event_type,
            eventTimestamp: row.event_timestamp,
            recordedDate: row.recorded_date,
            reason: row.reason,
            createdBy: row.created_by,
            createdAt: row.created_at,
            sourceLabel: "Manager correction" as const,
            status: audit.status,
          };
        })
        .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id)),
    },
    effectiveEvents: resolved.effective,
    sessions: analysis.sessions,
    completedMinutes: analysis.completedMinutes,
    hasOpenShift: analysis.hasOpenShift,
    warnings: analysis.warnings,
    suggestedMissingType: analysis.suggestedMissingType,
    review: reviewRow
      ? {
          status: reviewRow.status,
          reason: reviewRow.reason,
          reviewedAt: reviewRow.reviewed_at,
        }
      : null,
  };
}

export function buildStaffHoursRange(input: StaffHoursRangeSource): StaffHoursRange {
  const days: StaffHoursDay[] = [];
  for (const profile of input.profiles) {
    const relevantDates = new Set<string>();
    for (const shift of input.shifts) if (shift.staff_id === profile.id) relevantDates.add(shift.shift_date);
    for (const event of input.originals) if (event.staff_id === profile.id) relevantDates.add(event.recorded_date);
    for (const correction of input.corrections) if (correction.staff_id === profile.id) relevantDates.add(correction.recorded_date);
    for (const review of input.reviews) if (review.staff_id === profile.id) relevantDates.add(review.review_date);

    for (const date of [...relevantDates].sort()) {
      days.push(buildStaffDay(
        profile,
        date,
        input.shifts.filter((shift) => shift.staff_id === profile.id && shift.shift_date === date),
        input.originals.filter((event) => event.staff_id === profile.id && event.recorded_date === date),
        input.corrections.filter((correction) => correction.staff_id === profile.id && correction.recorded_date === date),
        input.reviews.find((review) => review.staff_id === profile.id && review.review_date === date),
      ));
    }
  }

  const totalByStaff = new Map((input.totals ?? []).map((row) => [row.staff_id, row]));
  const staff = input.profiles.map((profile) => {
    const staffDays = days.filter((day) => day.staffId === profile.id);
    const total = totalByStaff.get(profile.id);
    return {
      staffId: profile.id,
      displayName: profile.display_name,
      fullName: profile.full_name,
      completedMinutes: total?.completed_minutes
        ?? staffDays.reduce((sum, day) => sum + day.completedMinutes, 0),
      hasOpenShift: total
        ? (total.open_shift_count ?? 0) > 0
        : staffDays.some((day) => day.hasOpenShift),
      daysNeedingAttention: staffDays.filter((day) => day.warnings.length > 0).length,
    };
  }).sort((left, right) => {
    const issueOrder = Number(right.daysNeedingAttention > 0) - Number(left.daysNeedingAttention > 0);
    return issueOrder || compareNames(left, right);
  });

  return {
    from: input.from,
    to: input.to,
    currentWeekStart: input.currentWeekStart,
    currentWeekEnd: input.currentWeekEnd,
    staff,
    days,
  };
}

async function loadStaffHoursRange(
  fromValue?: string,
  toValue?: string,
  staffId?: string,
): Promise<StaffHoursRange> {
  await requireAccount(["manager"]);
  const supabase = await createSupabaseServerClient();
  const today = isoDateInLondon();
  const { data: weekRange, error: weekError } = await supabase.rpc("get_current_work_week_range", {
    reference_date: today,
  });
  const weekRow = Array.isArray(weekRange) ? weekRange[0] : null;
  if (weekError || !weekRow?.start_date || !weekRow?.end_date) {
    throw new Error("Current work week range could not be loaded.");
  }
  const currentWeek = {
    start: String(weekRow.start_date),
    end: String(weekRow.end_date),
  };
  const range = normaliseStaffHoursRange(fromValue, toValue, currentWeek);

  const [profiles, shifts, originals, corrections, reviews, totals] = await Promise.all([
    loadAllPostgrestPages<StaffHoursProfileSourceRow>((from, to) => {
      let query = supabase.from("staff_profiles")
        .select("id,display_name,full_name")
        .eq("active", true)
        .order("full_name")
        .order("id")
        .range(from, to);
      if (staffId) query = query.eq("id", staffId);
      return query;
    }),
    loadAllPostgrestPages<StaffHoursShiftSourceRow>((from, to) => {
      let query = supabase.from("rota_shifts")
        .select("id,staff_id,shift_date,start_time,end_time,break_minutes,rota_weeks!inner(status)")
        .gte("shift_date", range.from)
        .lte("shift_date", range.to)
        .is("archived_at", null)
        .neq("status", "cancelled")
        .eq("rota_weeks.status", "published")
        .order("shift_date")
        .order("start_time")
        .order("id")
        .range(from, to);
      if (staffId) query = query.eq("staff_id", staffId);
      return query;
    }),
    loadAllPostgrestPages<ClockEventSourceRow>((from, to) => {
      let query = supabase.from("clock_events")
        .select("id,staff_id,event_type,event_timestamp,recorded_date,event_source,manager_correction,correction_reason")
        .gte("recorded_date", range.from)
        .lte("recorded_date", range.to)
        .order("event_timestamp")
        .order("id")
        .range(from, to);
      if (staffId) query = query.eq("staff_id", staffId);
      return query;
    }),
    loadAllPostgrestPages<ClockCorrectionSourceRow>((from, to) => {
      let query = supabase.from("clock_event_corrections")
        .select("id,batch_id,correction_role,staff_id,correction_kind,original_event_id,supersedes_correction_id,event_type,event_timestamp,recorded_date,reason,created_by,created_at")
        .gte("recorded_date", range.from)
        .lte("recorded_date", range.to)
        .order("created_at")
        .order("id")
        .range(from, to);
      if (staffId) query = query.eq("staff_id", staffId);
      return query;
    }),
    loadAllPostgrestPages<StaffHoursReviewSourceRow>((from, to) => {
      let query = supabase.from("attendance_day_reviews")
        .select("staff_id,review_date,status,reason,reviewed_at")
        .gte("review_date", range.from)
        .lte("review_date", range.to)
        .order("review_date")
        .order("staff_id")
        .range(from, to);
      if (staffId) query = query.eq("staff_id", staffId);
      return query;
    }),
    loadAllPostgrestPages<StaffHoursTotalSourceRow>((from, to) => supabase.rpc(
      "get_manager_hours_preview",
      {
        range_start: range.from,
        range_end: range.to,
      },
    ).order("staff_id").range(from, to)),
  ]);
  return buildStaffHoursRange({
    ...range,
    currentWeekStart: currentWeek.start,
    currentWeekEnd: currentWeek.end,
    profiles,
    shifts,
    originals,
    corrections,
    reviews,
    totals,
  });
}

export async function loadStaffHoursList(from?: string, to?: string): Promise<StaffHoursList> {
  const range = await loadStaffHoursRange(from, to);
  return {
    from: range.from,
    to: range.to,
    currentWeekStart: range.currentWeekStart,
    currentWeekEnd: range.currentWeekEnd,
    rows: range.staff,
  };
}

export function toStaffHoursWeek(range: StaffHoursRange): StaffHoursWeek | null {
  const staff = range.staff[0];
  if (!staff) return null;
  return {
    from: range.from,
    to: range.to,
    currentWeekStart: range.currentWeekStart,
    currentWeekEnd: range.currentWeekEnd,
    staffId: staff.staffId,
    displayName: staff.displayName,
    fullName: staff.fullName,
    days: range.days,
  };
}

export async function loadStaffHoursWeek(
  staffId: string,
  from?: string,
  to?: string,
): Promise<StaffHoursWeek | null> {
  const validStaffId = parseStaffHoursWeekId(staffId);
  if (!validStaffId) return null;
  return toStaffHoursWeek(await loadStaffHoursRange(from, to, validStaffId));
}

export async function loadAttendanceDay(dateValue: string): Promise<AttendanceDay> {
  const date = validIsoDate(dateValue) ? dateValue : isoDateInLondon();
  const range = await loadStaffHoursRange(date, date);
  return {
    date,
    rows: [...range.days].sort((left, right) => {
      const issueOrder = Number(right.warnings.length > 0) - Number(left.warnings.length > 0);
      return issueOrder || compareNames(left, right);
    }),
  };
}
