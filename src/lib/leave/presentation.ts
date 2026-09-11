import { leaveTypeLabel } from "@/lib/calculations/leave";
import type { LeaveRequest, LeaveStatus } from "@/types";

export type LeaveStatusFilter = LeaveStatus | "all";

export function leaveStatusCounts(requests: LeaveRequest[]): Record<LeaveStatusFilter, number> {
  const counts: Record<LeaveStatusFilter, number> = {
    pending: 0,
    approved: 0,
    rejected: 0,
    cancelled: 0,
    all: requests.length,
  };
  for (const request of requests) counts[request.status] += 1;
  return counts;
}

export function orderLeaveRequests(requests: LeaveRequest[]): LeaveRequest[] {
  return [...requests].sort((left, right) => {
    const leftPriority = left.status === "pending" ? 0 : 1;
    const rightPriority = right.status === "pending" ? 0 : 1;
    return leftPriority - rightPriority || right.createdAt.localeCompare(left.createdAt);
  });
}

function durationSentence(minutes: number): string {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (!hours) return `${remainingMinutes} ${remainingMinutes === 1 ? "minute" : "minutes"}`;
  return `${hours} ${hours === 1 ? "hour" : "hours"} ${remainingMinutes} minutes`;
}

function longUkDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  }).format(new Date(`${value}T12:00:00Z`));
}

export function leaveDecisionConfirmation(
  request: LeaveRequest,
  staffName: string,
  decision: "approved" | "rejected",
): string {
  const action = decision === "approved" ? "Approve" : "Reject";
  const consequence = decision === "approved"
    ? "Existing rota shifts in this period will need review."
    : "The request will remain in leave history.";
  return `${action} ${leaveTypeLabel(request.leaveType).toLowerCase()} for ${staffName} from ${longUkDate(request.startDate)} to ${longUkDate(request.endDate)} (${durationSentence(request.requestedMinutes)})? ${consequence}`;
}

export function leaveCancellationConfirmation(request: LeaveRequest): string {
  return `Cancel your ${leaveTypeLabel(request.leaveType).toLowerCase()} request from ${longUkDate(request.startDate)} to ${longUkDate(request.endDate)}? The cancelled request will remain in your leave history.`;
}

export function leaveStatusLabel(status: LeaveStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}
