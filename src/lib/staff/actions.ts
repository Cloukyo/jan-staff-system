"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccount } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";

export type StaffActionState = { ok: boolean; message: string };

const fail = (message: string): StaffActionState => ({ ok: false, message });
const ok = (message: string): StaffActionState => ({ ok: true, message });

function text(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value || null;
}

function refreshStaffPaths(staffId: string) {
  revalidatePath("/staff");
  revalidatePath("/accounts");
  revalidatePath("/settings/kiosk");
  revalidatePath("/clock");
  revalidatePath("/rota");
  revalidatePath("/compliance");
  revalidatePath(`/compliance/staff/${staffId}`);
}

export async function createStaffProfileAction(
  _state: StaffActionState,
  formData: FormData,
): Promise<StaffActionState> {
  await requireAccount(["manager"]);
  const fullName = text(formData, "fullName");
  const employmentRole = text(formData, "employmentRole");
  if (!fullName || !employmentRole) return fail("Full name and role are required.");
  const id = crypto.randomUUID();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("staff_profiles").insert({
    id,
    full_name: fullName,
    display_name: text(formData, "displayName") ?? fullName.split(" ")[0],
    employment_role: employmentRole,
    main_qualification_level: text(formData, "mainQualificationLevel"),
    appointment_date: text(formData, "appointmentDate"),
    active: formData.get("active") === "on",
  });
  if (error) return fail("Staff profile could not be created. Check for a duplicate staff record.");
  revalidatePath("/staff");
  revalidatePath("/compliance");
  redirect(`/compliance/staff/${id}`);
}

export async function deactivateStaffProfileAction(
  _state: StaffActionState,
  formData: FormData,
): Promise<StaffActionState> {
  const manager = await requireAccount(["manager"]);
  const staffId = text(formData, "staffId");
  if (!staffId) return fail("Staff profile is required.");
  if (manager.staffId === staffId) return fail("You cannot deactivate your own staff profile.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_staff_profile_active", {
    p_staff_id: staffId,
    p_active: false,
  });
  if (error) return fail("Staff member could not be deactivated.");
  refreshStaffPaths(staffId);
  return ok("Staff member deactivated. Their history has been preserved.");
}

export async function reactivateStaffProfileAction(
  _state: StaffActionState,
  formData: FormData,
): Promise<StaffActionState> {
  await requireAccount(["manager"]);
  const staffId = text(formData, "staffId");
  if (!staffId) return fail("Staff profile is required.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_staff_profile_active", {
    p_staff_id: staffId,
    p_active: true,
  });
  if (error) return fail("Staff member could not be reactivated.");
  refreshStaffPaths(staffId);
  return ok("Staff member reactivated. Login and kiosk access remain disabled.");
}
