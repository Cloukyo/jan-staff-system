"use server";

import { revalidatePath } from "next/cache";
import { requireAccount } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import type { AttendanceReviewStatus } from "@/lib/attendance/review-server";

export async function saveAttendanceReviewAction(_state: { ok: boolean; message: string }, formData: FormData) {
  const account = await requireAccount(["manager"]);
  const staffId = String(formData.get("staffId") ?? "");
  const reviewDate = String(formData.get("reviewDate") ?? "");
  const status = String(formData.get("status") ?? "") as Exclude<AttendanceReviewStatus, "unreviewed">;
  const reason = String(formData.get("reason") ?? "").trim();
  if (!staffId || !/^\d{4}-\d{2}-\d{2}$/.test(reviewDate) || !["approved", "corrected", "ignored", "needs_staff_clarification"].includes(status)) {
    return { ok: false, message: "Choose a valid review decision." };
  }
  if (status !== "approved" && reason.length < 5) return { ok: false, message: "Enter a clear reason of at least five characters." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("attendance_day_reviews").upsert({
    staff_id: staffId,
    review_date: reviewDate,
    status,
    reason: reason || null,
    reviewed_by: account.id,
    reviewed_at: new Date().toISOString(),
  }, { onConflict: "staff_id,review_date" });
  if (error) return { ok: false, message: "The attendance review could not be saved." };
  revalidatePath("/attendance");
  revalidatePath("/payroll");
  return { ok: true, message: "Attendance review saved." };
}

export async function submitAttendanceCorrectionRequestAction(_state: { ok: boolean; message: string }, formData: FormData) {
  const account = await requireAccount(["staff"]);
  const attendanceDate = String(formData.get("attendanceDate") ?? "");
  const issueType = String(formData.get("issueType") ?? "");
  const staffNote = String(formData.get("staffNote") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(attendanceDate) || !["forgot_clock_in", "forgot_clock_out", "incorrect_time", "other"].includes(issueType) || staffNote.length < 5) {
    return { ok: false, message: "Choose a date, issue type and add a short explanation." };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("attendance_correction_requests").insert({
    staff_id: account.staffId,
    attendance_date: attendanceDate,
    issue_type: issueType,
    staff_note: staffNote,
  });
  if (error) return { ok: false, message: "Your attendance request could not be submitted." };
  revalidatePath("/my-attendance");
  revalidatePath("/attendance");
  return { ok: true, message: "Your attendance correction request was sent to a manager." };
}

export async function resolveAttendanceCorrectionRequestAction(_state: { ok: boolean; message: string }, formData: FormData) {
  const account = await requireAccount(["manager"]);
  const requestId = String(formData.get("requestId") ?? "");
  const status = String(formData.get("requestStatus") ?? "");
  const managerNote = String(formData.get("managerNote") ?? "").trim();
  if (!requestId || !["resolved", "rejected"].includes(status) || managerNote.length < 5) {
    return { ok: false, message: "Choose a decision and enter a clear manager note." };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("attendance_correction_requests").update({
    status,
    manager_note: managerNote,
    resolved_by: account.id,
    resolved_at: new Date().toISOString(),
  }).eq("id", requestId).eq("status", "pending");
  if (error) return { ok: false, message: "The staff request could not be closed." };
  revalidatePath("/attendance");
  revalidatePath("/payroll");
  return { ok: true, message: status === "resolved" ? "Staff request resolved." : "Staff request rejected." };
}
