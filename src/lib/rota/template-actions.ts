"use server";

import { revalidatePath } from "next/cache";
import { requireAccount } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import type { RotaActionState } from "@/lib/rota/actions";
import type { RotaTemplateApplyMode } from "@/lib/rota/template-types";
import { shiftDurationMinutes } from "@/lib/rota/validation";

const success = (message: string): RotaActionState => ({ ok: true, message });
const failure = (message: string): RotaActionState => ({ ok: false, message });

function text(formData: FormData, key: string): string | null {
  const result = String(formData.get(key) ?? "").trim();
  return result || null;
}

function refreshTemplates() {
  revalidatePath("/rota");
  revalidatePath("/rota/templates");
}

export async function createRotaTemplateAction(_state: RotaActionState, formData: FormData): Promise<RotaActionState> {
  const account = await requireAccount(["manager"]);
  const name = text(formData, "name");
  if (!name) return failure("Enter a template name.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("rota_templates").insert({
    name,
    description: text(formData, "description"),
    source_type: "manual",
    created_by: account.id,
    updated_by: account.id,
  });
  if (error) return failure("The template could not be created.");
  refreshTemplates();
  return success("Blank template created.");
}

export async function updateRotaTemplateAction(_state: RotaActionState, formData: FormData): Promise<RotaActionState> {
  const account = await requireAccount(["manager"]);
  const templateId = text(formData, "templateId");
  const name = text(formData, "name");
  if (!templateId || !name) return failure("Template and name are required.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("rota_templates").update({
    name,
    description: text(formData, "description"),
    updated_by: account.id,
  }).eq("id", templateId).eq("status", "active");
  if (error) return failure("The template details could not be saved.");
  refreshTemplates();
  return success("Template details saved.");
}

export async function saveRotaTemplateShiftAction(_state: RotaActionState, formData: FormData): Promise<RotaActionState> {
  const account = await requireAccount(["manager"]);
  const templateId = text(formData, "templateId");
  const shiftId = text(formData, "shiftId");
  const staffId = text(formData, "staffId");
  const dayOfWeek = Number(text(formData, "dayOfWeek"));
  const startTime = text(formData, "startTime");
  const endTime = text(formData, "endTime");
  const breakMinutes = Number(text(formData, "breakMinutes") ?? "0");
  if (!templateId || !staffId || !startTime || !endTime || !Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 7) {
    return failure("Staff, weekday, start time and finish time are required.");
  }
  const duration = shiftDurationMinutes(startTime, endTime);
  if (duration <= 0) return failure("Finish time must be after start time.");
  if (!Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes > duration) {
    return failure("Break minutes must fit within the shift.");
  }
  const payload = {
    template_id: templateId,
    staff_id: staffId,
    day_of_week: dayOfWeek,
    start_time: startTime,
    end_time: endTime,
    break_minutes: breakMinutes,
    room_or_area: text(formData, "roomOrArea"),
    role_on_shift: text(formData, "roleOnShift"),
    notes: text(formData, "notes"),
    sort_order: Number(text(formData, "sortOrder") ?? "0"),
    updated_by: account.id,
  };
  const supabase = await createSupabaseServerClient();
  const result = shiftId
    ? await supabase.from("rota_template_shifts").update(payload).eq("id", shiftId)
    : await supabase.from("rota_template_shifts").insert({ ...payload, created_by: account.id });
  if (result.error) {
    return failure(result.error.code === "23505" ? "An identical active template shift already exists." : "The template shift could not be saved.");
  }
  refreshTemplates();
  return success(shiftId ? "Template shift updated." : "Template shift added.");
}

export async function archiveRotaTemplateShiftAction(_state: RotaActionState, formData: FormData): Promise<RotaActionState> {
  const account = await requireAccount(["manager"]);
  const shiftId = text(formData, "shiftId");
  if (!shiftId) return failure("Template shift not found.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("rota_template_shifts").update({
    archived_at: new Date().toISOString(),
    archived_by: account.id,
    updated_by: account.id,
  }).eq("id", shiftId);
  if (error) return failure("The template shift could not be archived.");
  refreshTemplates();
  return success("Template shift archived.");
}

export async function duplicateRotaTemplateShiftAction(_state: RotaActionState, formData: FormData): Promise<RotaActionState> {
  const account = await requireAccount(["manager"]);
  const shiftId = text(formData, "shiftId");
  const dayOfWeek = Number(text(formData, "dayOfWeek"));
  if (!shiftId || !Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 7) return failure("Choose a target weekday.");
  const supabase = await createSupabaseServerClient();
  const { data, error: readError } = await supabase.from("rota_template_shifts").select("*").eq("id", shiftId).single();
  if (readError || !data) return failure("The source template shift could not be found.");
  const { error } = await supabase.from("rota_template_shifts").insert({
    template_id: data.template_id,
    staff_id: data.staff_id,
    day_of_week: dayOfWeek,
    start_time: data.start_time,
    end_time: data.end_time,
    break_minutes: data.break_minutes,
    room_or_area: data.room_or_area,
    role_on_shift: data.role_on_shift,
    notes: data.notes,
    sort_order: data.sort_order,
    created_by: account.id,
    updated_by: account.id,
  });
  if (error) return failure(error.code === "23505" ? "An identical shift already exists on that weekday." : "The template shift could not be duplicated.");
  refreshTemplates();
  return success("Template shift duplicated.");
}

export async function archiveRotaTemplateAction(_state: RotaActionState, formData: FormData): Promise<RotaActionState> {
  const account = await requireAccount(["manager"]);
  const templateId = text(formData, "templateId");
  if (!templateId) return failure("Template not found.");
  const now = new Date().toISOString();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("rota_templates").update({
    status: "archived",
    archived_at: now,
    archived_by: account.id,
    updated_by: account.id,
  }).eq("id", templateId).eq("status", "active");
  if (error) return failure("The template could not be archived.");
  refreshTemplates();
  return success("Template archived.");
}

export async function duplicateRotaTemplateAction(_state: RotaActionState, formData: FormData): Promise<RotaActionState> {
  await requireAccount(["manager"]);
  const templateId = text(formData, "templateId");
  const name = text(formData, "name");
  if (!templateId || !name) return failure("Choose a template and enter a new name.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("duplicate_rota_template", {
    source_template_id: templateId,
    new_name: name,
  });
  if (error) return failure("The template could not be duplicated.");
  refreshTemplates();
  return success("Template duplicated.");
}

export async function saveRotaWeekAsTemplateAction(_state: RotaActionState, formData: FormData): Promise<RotaActionState> {
  await requireAccount(["manager"]);
  const weekId = text(formData, "weekId");
  const name = text(formData, "name");
  if (!weekId || !name) return failure("Rota week and template name are required.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("save_rota_week_as_template", {
    source_week_id: weekId,
    template_name: name,
    template_description: text(formData, "description"),
    include_cancelled: formData.get("includeCancelled") === "on",
  });
  if (error) return failure("The rota week could not be saved as a template.");
  refreshTemplates();
  return success("The rota week was saved as an independent template.");
}

export async function applyRotaTemplateAction(_state: RotaActionState, formData: FormData): Promise<RotaActionState> {
  await requireAccount(["manager"]);
  const templateId = text(formData, "templateId");
  const weekId = text(formData, "weekId");
  const requestKey = text(formData, "requestKey");
  const mode = text(formData, "mode") as RotaTemplateApplyMode | null;
  if (!templateId || !weekId || !requestKey || !mode || !["empty_days", "replace", "alongside"].includes(mode)) {
    return failure("Template application details are incomplete.");
  }
  if (mode === "replace" && formData.get("confirmReplace") !== "on") {
    return failure("Tick the replacement confirmation before applying this mode.");
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("apply_rota_template", {
    source_template_id: templateId,
    target_week_id: weekId,
    requested_mode: mode,
    request_key: requestKey,
    confirm_replace: mode === "replace",
    leave_override_reason: text(formData, "leaveOverrideReason"),
    overlap_override_reason: text(formData, "overlapOverrideReason"),
  });
  if (error) {
    if (error.message.includes("Approved leave")) return failure("Approved leave conflicts require a manager override reason.");
    if (error.message.includes("Overlapping shift")) return failure("Overlapping shifts require a manager override reason.");
    if (error.message.includes("Inactive staff")) return failure("Resolve inactive staff before applying this template.");
    return failure("The template could not be applied.");
  }
  const result = data as { created_shifts?: number; archived_shifts?: number; retried?: boolean } | null;
  refreshTemplates();
  return success(result?.retried
    ? "This template application was already completed. No duplicates were created."
    : `${Number(result?.created_shifts ?? 0)} shifts created and ${Number(result?.archived_shifts ?? 0)} existing shifts archived.`);
}
