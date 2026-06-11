import { differenceInMinutes, eachDayOfInterval, isAfter, isWeekend, parseISO } from "date-fns";
import type { LeaveDayPart, LeaveRequest, LeaveStatus, RotaShift } from "@/types";
import { toDateTime } from "@/lib/dates/format";

export const blockingLeaveStatuses: LeaveStatus[] = ["pending", "approved"];

export function leaveTypeLabel(value: LeaveRequest["leaveType"]): string {
  const labels: Record<LeaveRequest["leaveType"], string> = {
    annual_leave: "Annual leave",
    sickness: "Sickness",
    medical_appointment: "Medical appointment",
    unpaid_leave: "Unpaid leave",
    training: "Training",
    other: "Other",
  };
  return labels[value];
}

export function leaveStatusTone(status: LeaveStatus): "green" | "amber" | "red" | "grey" | "purple" {
  if (status === "approved") return "green";
  if (status === "pending") return "amber";
  if (status === "rejected") return "red";
  return "grey";
}

export function workingDatesBetween(startDate: string, endDate: string, closureDates: string[] = []): string[] {
  const closures = new Set(closureDates);
  return eachDayOfInterval({ start: parseISO(startDate), end: parseISO(endDate) })
    .filter((date) => !isWeekend(date))
    .map((date) => date.toISOString().slice(0, 10))
    .filter((date) => !closures.has(date));
}

export function calculateLeaveMinutes(input: {
  startDate: string;
  endDate: string;
  dayPart: LeaveDayPart;
  startTime?: string | null;
  endTime?: string | null;
  standardDayMinutes?: number;
  closureDates?: string[];
}): number {
  const workingDates = workingDatesBetween(input.startDate, input.endDate, input.closureDates);
  if (input.dayPart === "partial_day") {
    if (input.startDate !== input.endDate || !input.startTime || !input.endTime) return 0;
    return Math.max(0, differenceInMinutes(toDateTime(input.startDate, input.endTime), toDateTime(input.startDate, input.startTime)));
  }
  return workingDates.length * (input.standardDayMinutes ?? 450);
}

export function validateLeaveRequestInput(input: {
  leaveType?: string;
  startDate?: string;
  endDate?: string;
  dayPart?: LeaveDayPart;
  startTime?: string | null;
  endTime?: string | null;
}): string[] {
  const errors: string[] = [];
  if (!input.leaveType) errors.push("Choose a leave type.");
  if (!input.startDate) errors.push("Choose a start date.");
  if (!input.endDate) errors.push("Choose an end date.");
  if (input.startDate && input.endDate && isAfter(parseISO(input.startDate), parseISO(input.endDate))) errors.push("Start date cannot be after end date.");
  if (input.dayPart === "partial_day") {
    if (!input.startTime || !input.endTime) errors.push("Add start and end times for partial-day leave.");
    if (input.startDate && input.endDate && input.startDate !== input.endDate) errors.push("Partial-day leave must be a single day.");
    if (input.startDate && input.startTime && input.endTime && toDateTime(input.startDate, input.endTime) <= toDateTime(input.startDate, input.startTime)) {
      errors.push("End time must be after start time.");
    }
  }
  return errors;
}

export function leaveRequestsOverlap(a: Pick<LeaveRequest, "staffId" | "startDate" | "endDate" | "status">, b: Pick<LeaveRequest, "staffId" | "startDate" | "endDate">): boolean {
  if (a.staffId !== b.staffId) return false;
  if (!blockingLeaveStatuses.includes(a.status)) return false;
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

export function findOverlappingLeave(
  requests: LeaveRequest[],
  input: Pick<LeaveRequest, "staffId" | "startDate" | "endDate">,
  ignoreRequestId?: string,
): LeaveRequest[] {
  return requests.filter((request) => request.id !== ignoreRequestId && leaveRequestsOverlap(request, input));
}

export function findRotaLeaveWarnings(shift: RotaShift, requests: LeaveRequest[]): LeaveRequest[] {
  if (shift.status !== "working") return [];
  return requests.filter(
    (request) =>
      request.staffId === shift.staffId &&
      ["pending", "approved"].includes(request.status) &&
      request.startDate <= shift.date &&
      request.endDate >= shift.date,
  );
}
