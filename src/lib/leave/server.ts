"use server";

import { revalidatePath } from "next/cache";
import type { LeaveRequest, LeaveStatus, LeaveType, LeaveDayPart, StaffAccount } from "@/types";
import { canAccessStaffRecord, mapStaffAccount, requireAccount } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { calculateLeaveMinutes, findOverlappingLeave, validateLeaveRequestInput } from "@/lib/calculations/leave";

type LeaveRequestRow = {
  id: string;
  staff_id: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  day_part: LeaveDayPart;
  start_time: string | null;
  end_time: string | null;
  requested_minutes: number;
  staff_note: string | null;
  status: LeaveStatus;
  manager_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ActionResult = {
  ok: boolean;
  message: string;
};

function mapLeaveRequest(row: LeaveRequestRow): LeaveRequest {
  return {
    id: row.id,
    staffId: row.staff_id,
    leaveType: row.leave_type,
    startDate: row.start_date,
    endDate: row.end_date,
    dayPart: row.day_part,
    startTime: row.start_time,
    endTime: row.end_time,
    requestedMinutes: row.requested_minutes,
    staffNote: row.staff_note ?? "",
    status: row.status,
    managerNote: row.manager_note,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listLeaveRequestsForAccount(account: StaffAccount): Promise<LeaveRequest[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase.from("leave_requests").select("*").order("created_at", { ascending: false });
  if (account.role !== "manager") query = query.eq("staff_id", account.staffId);
  const { data, error } = await query;
  if (error) throw new Error("Leave requests could not be loaded.");
  return (data as LeaveRequestRow[]).map(mapLeaveRequest);
}

export async function listStaffAccounts(): Promise<StaffAccount[]> {
  await requireAccount(["manager"]);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("staff_accounts").select("*").order("full_name", { ascending: true });
  if (error) throw new Error("Accounts could not be loaded.");
  return data.map((row) => mapStaffAccount(row));
}

export async function createLeaveRequestAction(_state: ActionResult, formData: FormData): Promise<ActionResult> {
  const account = await requireAccount(["manager", "staff"]);
  const staffId = account.role === "manager" ? String(formData.get("staffId") || account.staffId) : account.staffId;
  if (!canAccessStaffRecord(account, staffId)) return { ok: false, message: "You cannot submit leave for another staff member." };
  const input = {
    staffId,
    leaveType: String(formData.get("leaveType") ?? "") as LeaveType,
    startDate: String(formData.get("startDate") ?? ""),
    endDate: String(formData.get("endDate") ?? ""),
    dayPart: String(formData.get("dayPart") ?? "full_day") as LeaveDayPart,
    startTime: String(formData.get("startTime") || "") || null,
    endTime: String(formData.get("endTime") || "") || null,
    staffNote: String(formData.get("staffNote") ?? "").trim(),
  };
  const errors = validateLeaveRequestInput(input);
  const requestedMinutes = calculateLeaveMinutes(input);
  if (!requestedMinutes) errors.push("The selected dates do not include any working time.");
  if (errors.length) return { ok: false, message: errors[0] };
  const supabase = await createSupabaseServerClient();
  const { data: existing, error: existingError } = await supabase
    .from("leave_requests")
    .select("*")
    .eq("staff_id", staffId)
    .in("status", ["pending", "approved"])
    .lte("start_date", input.endDate)
    .gte("end_date", input.startDate);
  if (existingError) return { ok: false, message: "Could not check existing leave. Please try again." };
  if (findOverlappingLeave((existing as LeaveRequestRow[]).map(mapLeaveRequest), { staffId, startDate: input.startDate, endDate: input.endDate }).length) {
    return { ok: false, message: "This overlaps an existing pending or approved leave request." };
  }
  const { error } = await supabase.from("leave_requests").insert({
    staff_id: staffId,
    leave_type: input.leaveType,
    start_date: input.startDate,
    end_date: input.endDate,
    day_part: input.dayPart,
    start_time: input.dayPart === "partial_day" ? input.startTime : null,
    end_time: input.dayPart === "partial_day" ? input.endTime : null,
    requested_minutes: requestedMinutes,
    staff_note: input.staffNote,
    status: "pending",
  });
  if (error) return { ok: false, message: "Leave request could not be saved." };
  revalidatePath("/leave");
  revalidatePath("/leave/requests");
  return { ok: true, message: "Leave request submitted." };
}

export async function cancelLeaveRequestAction(_state: ActionResult, formData: FormData): Promise<ActionResult> {
  const account = await requireAccount(["manager", "staff"]);
  const requestId = String(formData.get("requestId") ?? "");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("leave_requests").select("*").eq("id", requestId).maybeSingle();
  if (error || !data) return { ok: false, message: "Leave request not found." };
  const request = mapLeaveRequest(data as LeaveRequestRow);
  if (!canAccessStaffRecord(account, request.staffId)) return { ok: false, message: "You cannot cancel this request." };
  if (request.status !== "pending") return { ok: false, message: "Only pending requests can be cancelled." };
  const { error: updateError } = await supabase.from("leave_requests").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("id", requestId).eq("status", "pending");
  if (updateError) return { ok: false, message: "Leave request could not be cancelled." };
  revalidatePath("/leave");
  revalidatePath("/leave/requests");
  return { ok: true, message: "Leave request cancelled." };
}

export async function reviewLeaveRequestAction(_state: ActionResult, formData: FormData): Promise<ActionResult> {
  const account = await requireAccount(["manager"]);
  const requestId = String(formData.get("requestId") ?? "");
  const status = String(formData.get("status") ?? "") as Extract<LeaveStatus, "approved" | "rejected">;
  const managerNote = String(formData.get("managerNote") ?? "").trim();
  if (!["approved", "rejected"].includes(status)) return { ok: false, message: "Choose approve or reject." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("leave_requests")
    .update({ status, manager_note: managerNote || null, reviewed_by: account.id, reviewed_at: new Date().toISOString() })
    .eq("id", requestId)
    .eq("status", "pending");
  if (error) return { ok: false, message: "Leave request could not be reviewed." };
  revalidatePath("/leave");
  revalidatePath("/leave/requests");
  return { ok: true, message: status === "approved" ? "Leave approved." : "Leave rejected." };
}
