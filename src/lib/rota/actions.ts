"use server";

import { revalidatePath } from "next/cache";
import { requireAccount } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { shiftDurationMinutes } from "@/lib/rota/validation";

export type RotaActionState = { ok: boolean; message: string };

const success = (message: string): RotaActionState => ({ ok: true, message });
const failure = (message: string): RotaActionState => ({ ok: false, message });

function text(formData: FormData, key: string): string | null {
  const result = String(formData.get(key) ?? "").trim();
  return result || null;
}

function friendlyDatabaseError(message?: string): string {
  if (!message) return "The rota change could not be saved.";
  if (message.includes("Approved leave conflict")) return "This shift overlaps approved leave. Add a manager override reason.";
  if (message.includes("Overlapping shift")) return "This shift overlaps another shift. Add a manager override reason.";
  if (message.includes("duplicate key")) return "An identical active shift already exists.";
  if (message.includes("Inactive staff")) return "Inactive staff cannot be scheduled without an enabled override and reason.";
  return "The rota change could not be saved.";
}

export async function createRotaWeekAction(_state: RotaActionState, formData: FormData): Promise<RotaActionState> {
  const account = await requireAccount(["manager"]);
  const weekStart = text(formData, "weekStart");
  if (!weekStart) return failure("Choose a week starting on Monday.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("rota_weeks").insert({
    week_start_date: weekStart,
    status: "draft",
    title: text(formData, "title"),
    notes: text(formData, "notes"),
    created_by: account.id,
    updated_by: account.id,
  });
  if (error) return failure(error.code === "23505" ? "An active rota already exists for this week." : "The rota week could not be created.");
  revalidatePath("/rota");
  return success("Draft rota created.");
}

export async function saveRotaShiftAction(_state: RotaActionState, formData: FormData): Promise<RotaActionState> {
  const account = await requireAccount(["manager"]);
  const shiftId = text(formData, "shiftId");
  const rotaWeekId = text(formData, "rotaWeekId");
  const staffId = text(formData, "staffId");
  const shiftDate = text(formData, "shiftDate");
  const startTime = text(formData, "startTime");
  const endTime = text(formData, "endTime");
  const breakMinutes = Number(text(formData, "breakMinutes") ?? "0");
  if (!rotaWeekId || !staffId || !shiftDate || !startTime || !endTime) return failure("Staff, date, start time and finish time are required.");
  const duration = shiftDurationMinutes(startTime, endTime);
  if (duration <= 0) return failure("Finish time must be after start time. Overnight shifts are not supported.");
  if (!Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes > duration) return failure("Break minutes must be between zero and the shift duration.");

  const payload = {
    rota_week_id: rotaWeekId,
    staff_id: staffId,
    shift_date: shiftDate,
    start_time: startTime,
    end_time: endTime,
    break_minutes: breakMinutes,
    room_or_area: text(formData, "roomOrArea"),
    role_on_shift: text(formData, "roleOnShift"),
    notes: text(formData, "notes"),
    status: text(formData, "status") ?? "scheduled",
    inactive_staff_override_reason: text(formData, "inactiveStaffOverrideReason"),
    leave_override_reason: text(formData, "leaveOverrideReason"),
    overlap_override_reason: text(formData, "overlapOverrideReason"),
    updated_by: account.id,
  };
  const supabase = await createSupabaseServerClient();
  const result = shiftId
    ? await supabase.from("rota_shifts").update(payload).eq("id", shiftId)
    : await supabase.from("rota_shifts").insert({ ...payload, created_by: account.id });
  if (result.error) return failure(friendlyDatabaseError(result.error.message));
  revalidatePath("/rota");
  return success(shiftId ? "Shift updated." : "Shift added.");
}

export async function archiveRotaShiftAction(_state: RotaActionState, formData: FormData): Promise<RotaActionState> {
  const account = await requireAccount(["manager"]);
  const shiftId = text(formData, "shiftId");
  if (!shiftId) return failure("Shift not found.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("rota_shifts").update({
    archived_at: new Date().toISOString(),
    archived_by: account.id,
    updated_by: account.id,
  }).eq("id", shiftId);
  if (error) return failure("The shift could not be archived.");
  revalidatePath("/rota");
  return success("Shift archived.");
}

export async function duplicateRotaShiftAction(_state: RotaActionState, formData: FormData): Promise<RotaActionState> {
  const account = await requireAccount(["manager"]);
  const shiftId = text(formData, "shiftId");
  const targetDate = text(formData, "targetDate");
  if (!shiftId || !targetDate) return failure("Choose a target date.");
  const supabase = await createSupabaseServerClient();
  const { data, error: readError } = await supabase.from("rota_shifts").select("*").eq("id", shiftId).single();
  if (readError || !data) return failure("The source shift could not be found.");
  const { error } = await supabase.from("rota_shifts").insert({
    rota_week_id: data.rota_week_id,
    staff_id: data.staff_id,
    shift_date: targetDate,
    start_time: data.start_time,
    end_time: data.end_time,
    break_minutes: data.break_minutes,
    room_or_area: data.room_or_area,
    role_on_shift: data.role_on_shift,
    notes: data.notes,
    status: "scheduled",
    inactive_staff_override_reason: data.inactive_staff_override_reason,
    leave_override_reason: data.leave_override_reason,
    overlap_override_reason: data.overlap_override_reason,
    created_by: account.id,
    updated_by: account.id,
  });
  if (error) return failure(friendlyDatabaseError(error.message));
  revalidatePath("/rota");
  return success("Shift duplicated.");
}

export async function setRotaWeekStatusAction(_state: RotaActionState, formData: FormData): Promise<RotaActionState> {
  const account = await requireAccount(["manager"]);
  const weekId = text(formData, "weekId");
  const status = text(formData, "status");
  if (!weekId || !status || !["draft", "published", "archived"].includes(status)) return failure("Invalid rota status.");
  const now = new Date().toISOString();
  const audit = status === "published"
    ? { published_at: now, published_by: account.id }
    : status === "archived"
      ? { archived_at: now, archived_by: account.id }
      : {};
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("rota_weeks").update({ status, updated_by: account.id, ...audit }).eq("id", weekId);
  if (error) return failure("The rota status could not be changed.");
  revalidatePath("/rota");
  return success(status === "published" ? "Rota published." : status === "archived" ? "Rota archived." : "Rota returned to draft.");
}

export async function copyPreviousRotaWeekAction(_state: RotaActionState, formData: FormData): Promise<RotaActionState> {
  await requireAccount(["manager"]);
  const weekStart = text(formData, "weekStart");
  if (!weekStart) return failure("Choose a target week.");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("copy_previous_rota_week", { target_week_start: weekStart });
  if (error) return failure(friendlyDatabaseError(error.message));
  const count = Number((data as { copied_shifts?: number } | null)?.copied_shifts ?? 0);
  revalidatePath("/rota");
  return success(count ? `${count} shifts copied into the draft week.` : "No new shifts needed copying.");
}

export async function copyRotaDayAction(_state: RotaActionState, formData: FormData): Promise<RotaActionState> {
  await requireAccount(["manager"]);
  const weekId = text(formData, "weekId");
  const sourceDate = text(formData, "sourceDate");
  const targetDate = text(formData, "targetDate");
  if (!weekId || !sourceDate || !targetDate) return failure("Choose a source and target day.");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("copy_rota_day", {
    target_week_id: weekId,
    source_shift_date: sourceDate,
    target_shift_date: targetDate,
  });
  if (error) return failure(friendlyDatabaseError(error.message));
  const count = Number((data as { copied_shifts?: number } | null)?.copied_shifts ?? 0);
  revalidatePath("/rota");
  return success(count ? `${count} shifts copied.` : "No new shifts needed copying.");
}

export async function clearRotaDayAction(_state: RotaActionState, formData: FormData): Promise<RotaActionState> {
  const account = await requireAccount(["manager"]);
  const weekId = text(formData, "weekId");
  const shiftDate = text(formData, "shiftDate");
  if (!weekId || !shiftDate) return failure("Choose a day to clear.");
  const supabase = await createSupabaseServerClient();
  const { data: week, error: weekError } = await supabase.from("rota_weeks").select("status").eq("id", weekId).single();
  if (weekError || week?.status !== "draft") return failure("Only a draft rota day can be cleared.");
  const { error } = await supabase.from("rota_shifts").update({
    archived_at: new Date().toISOString(),
    archived_by: account.id,
    updated_by: account.id,
  }).eq("rota_week_id", weekId).eq("shift_date", shiftDate).is("archived_at", null);
  if (error) return failure("The day could not be cleared.");
  revalidatePath("/rota");
  return success("Draft shifts cleared from the selected day.");
}
