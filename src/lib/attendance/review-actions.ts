"use server";

import { revalidatePath } from "next/cache";
import { requireAttendanceActor, requireAttendanceSelfActor } from "@/lib/attendance/server-actor";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import type { AttendanceReviewStatus } from "@/lib/attendance/review-server";
import {
  buildAttendanceExceptionResolutionPlan,
  type AttendanceExceptionResolutionKind,
} from "@/lib/attendance/exceptions-server";
import { londonLocalDateTimeToIso } from "@/lib/dates/format";

type AttendanceDecisionState = { ok: boolean; message: string; conflict?: boolean };

function exceptionActionError(error: { code?: string; message?: string } | null): AttendanceDecisionState {
  const message = error?.message ?? "";
  if (error?.code === "40001" || /changed after|no longer available|already used/i.test(message)) {
    return {
      ok: false,
      conflict: true,
      message: "Attendance changed while you were reviewing it. Reload the latest issue before trying again.",
    };
  }
  return { ok: false, message: "The attendance decision could not be saved." };
}

export async function saveAttendanceReviewAction(_state: { ok: boolean; message: string }, formData: FormData) {
  const actor = await requireAttendanceActor("attendance.review", { siteRequired: true });
  const staffId = String(formData.get("staffId") ?? "");
  const reviewDate = String(formData.get("reviewDate") ?? "");
  const status = String(formData.get("status") ?? "") as Exclude<AttendanceReviewStatus, "unreviewed">;
  const reason = String(formData.get("reason") ?? "").trim();
  if (!staffId || !/^\d{4}-\d{2}-\d{2}$/.test(reviewDate) || !["approved", "corrected", "ignored", "needs_staff_clarification"].includes(status)) {
    return { ok: false, message: "Choose a valid review decision." };
  }
  if (status !== "approved" && reason.length < 5) return { ok: false, message: "Enter a clear reason of at least five characters." };
  const supabase = await createSupabaseServerClient();
  let error: { message: string } | null;
  if (actor.kind === "commercial") {
    ({ error } = await supabase.rpc("save_commercial_attendance_day_review", {
      target_organisation_id: actor.context.organisationId,
      target_site_id: actor.context.selectedSiteId!,
      target_staff_id: staffId,
      target_date: reviewDate,
      requested_status: status,
      reason: reason || "",
    }));
  } else {
    const values = {
      staff_id: staffId, review_date: reviewDate, status, reason: reason || null,
      reviewed_by: actor.account.id, reviewed_at: new Date().toISOString(),
    };
    const updated = await supabase.from("attendance_day_reviews").update(values)
      .eq("staff_id", staffId).eq("review_date", reviewDate).is("organisation_id", null);
    if (updated.error) error = updated.error;
    else {
      const inserted = await supabase.from("attendance_day_reviews").insert(values);
      error = inserted.error && !/duplicate/i.test(inserted.error.message) ? inserted.error : null;
    }
  }
  if (error) return { ok: false, message: "The attendance review could not be saved." };
  revalidatePath("/attendance");
  revalidatePath("/payroll");
  return { ok: true, message: "Attendance review saved." };
}

export async function submitAttendanceCorrectionRequestAction(_state: { ok: boolean; message: string }, formData: FormData) {
  const actor = await requireAttendanceSelfActor();
  const attendanceDate = String(formData.get("attendanceDate") ?? "");
  const issueType = String(formData.get("issueType") ?? "");
  const staffNote = String(formData.get("staffNote") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(attendanceDate) || !["forgot_clock_in", "forgot_clock_out", "incorrect_time", "other"].includes(issueType) || staffNote.length < 5) {
    return { ok: false, message: "Choose a date, issue type and add a short explanation." };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = actor.kind === "commercial"
    ? await supabase.rpc("submit_commercial_attendance_correction_request", {
      target_organisation_id: actor.context.organisationId,
      target_site_id: actor.context.selectedSiteId!,
      target_date: attendanceDate,
      issue_type: issueType,
      staff_note: staffNote,
    })
    : await supabase.from("attendance_correction_requests").insert({
      staff_id: actor.account.staffId,
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
  const actor = await requireAttendanceActor("attendance.review", { siteRequired: true });
  const requestId = String(formData.get("requestId") ?? "");
  const status = String(formData.get("requestStatus") ?? "");
  const managerNote = String(formData.get("managerNote") ?? "").trim();
  if (!requestId || !["resolved", "rejected"].includes(status) || managerNote.length < 5) {
    return { ok: false, message: "Choose a decision and enter a clear manager note." };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = actor.kind === "commercial"
    ? await supabase.rpc("resolve_commercial_attendance_correction_request", {
      target_organisation_id: actor.context.organisationId,
      target_site_id: actor.context.selectedSiteId!,
      target_request_id: requestId,
      requested_status: status,
      manager_note: managerNote,
    })
    : await supabase.from("attendance_correction_requests").update({
      status,
      manager_note: managerNote,
      resolved_by: actor.account.id,
      resolved_at: new Date().toISOString(),
    }).eq("id", requestId).eq("status", "pending").is("organisation_id", null);
  if (error) return { ok: false, message: "The staff request could not be closed." };
  revalidatePath("/attendance");
  revalidatePath("/payroll");
  return { ok: true, message: status === "resolved" ? "Staff request resolved." : "Staff request rejected." };
}

export async function resolveAttendanceExceptionAction(
  _state: AttendanceDecisionState,
  formData: FormData,
): Promise<AttendanceDecisionState> {
  const actor = await requireAttendanceActor("attendance.correct", { siteRequired: true });
  const exceptionId = String(formData.get("exceptionId") ?? "");
  const staffId = String(formData.get("staffId") ?? "");
  const operationalDate = String(formData.get("operationalDate") ?? "");
  const expectedRevision = String(formData.get("expectedRevision") ?? "");
  const resolutionKind = String(formData.get("resolutionKind") ?? "") as AttendanceExceptionResolutionKind;
  const reason = String(formData.get("reason") ?? "").trim();
  const localTimestamp = String(formData.get("eventTimestamp") ?? "");
  if (!exceptionId || !staffId || !expectedRevision
    || !/^\d{4}-\d{2}-\d{2}$/.test(operationalDate)
    || !["add_missing_clock_in", "add_missing_clock_out", "correct_clock_in", "correct_clock_out"].includes(resolutionKind)
    || reason.length < 5) {
    return { ok: false, message: "Choose a correction and enter a clear reason of at least five characters." };
  }

  let eventTimestamp: string;
  try {
    eventTimestamp = londonLocalDateTimeToIso(localTimestamp);
  } catch {
    return { ok: false, message: "Choose a valid correction date and time in London." };
  }

  let correctionPlan: ReturnType<typeof buildAttendanceExceptionResolutionPlan>;
  try {
    correctionPlan = buildAttendanceExceptionResolutionPlan({
      operationId: exceptionId,
      staffId,
      operationalDate,
      resolutionKind,
      eventTimestamp,
      effectiveEventId: String(formData.get("effectiveEventId") ?? "") || undefined,
      originalEventId: String(formData.get("originalEventId") ?? "") || null,
      correctionId: String(formData.get("correctionId") ?? "") || null,
    });
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Choose a valid correction." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = actor.kind === "commercial"
    ? await supabase.rpc("resolve_commercial_attendance_exception", {
      target_organisation_id: actor.context.organisationId,
      target_site_id: actor.context.selectedSiteId!,
      target_exception_id: exceptionId,
      correction_plan: correctionPlan,
      reason,
      expected_revision: expectedRevision,
      operation_id: exceptionId,
    })
    : await supabase.rpc("resolve_attendance_exception", {
    target_exception_id: exceptionId,
    correction_plan: correctionPlan,
    reason,
    expected_revision: expectedRevision,
    operation_id: exceptionId,
    });
  if (error) return exceptionActionError(error);
  revalidatePath("/attendance");
  revalidatePath("/dashboard");
  revalidatePath("/payroll");
  revalidatePath("/my-attendance");
  return { ok: true, message: "Attendance issue resolved and correction recorded." };
}

export async function dismissAttendanceExceptionAction(
  _state: AttendanceDecisionState,
  formData: FormData,
): Promise<AttendanceDecisionState> {
  const actor = await requireAttendanceActor("attendance.review", { siteRequired: true });
  const exceptionId = String(formData.get("exceptionId") ?? "");
  const expectedRevision = String(formData.get("expectedRevision") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!exceptionId || !expectedRevision || reason.length < 5) {
    return { ok: false, message: "Enter a clear reason of at least five characters." };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = actor.kind === "commercial"
    ? await supabase.rpc("dismiss_commercial_attendance_exception", {
      target_organisation_id: actor.context.organisationId,
      target_site_id: actor.context.selectedSiteId!,
      target_exception_id: exceptionId,
      reason,
      expected_revision: expectedRevision,
      operation_id: exceptionId,
    })
    : await supabase.rpc("dismiss_attendance_exception", {
    target_exception_id: exceptionId,
    reason,
    expected_revision: expectedRevision,
    operation_id: exceptionId,
    });
  if (error) return exceptionActionError(error);
  revalidatePath("/attendance");
  revalidatePath("/dashboard");
  revalidatePath("/payroll");
  return { ok: true, message: "Attendance issue dismissed with no attendance change." };
}
