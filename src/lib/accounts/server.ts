"use server";

import { revalidatePath } from "next/cache";
import type { AppRole } from "@/types";
import { requireAccount } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import type { ActionResult } from "@/lib/leave/server";

export async function createStaffAccountAction(_state: ActionResult, formData: FormData): Promise<ActionResult> {
  const manager = await requireAccount(["manager"]);
  const staffId = String(formData.get("staffId") ?? "");
  const fullName = String(formData.get("fullName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "staff") as AppRole;
  if (!staffId || !fullName || !email) return { ok: false, message: "Staff member, name and email are required." };
  if (!["manager", "staff"].includes(role)) return { ok: false, message: "Choose a valid role." };
  const supabase = await createSupabaseServerClient();
  const [{ data: profile }, { data: emailDuplicate }, { data: existing }] = await Promise.all([
    supabase.from("staff_profiles").select("id,full_name").eq("id", staffId).maybeSingle(),
    supabase.from("staff_accounts").select("id,staff_id").eq("email", email).maybeSingle(),
    supabase.from("staff_accounts").select("id,auth_user_id").eq("staff_id", staffId).maybeSingle(),
  ]);
  if (!profile) return { ok: false, message: "Choose an existing canonical staff profile." };
  if (emailDuplicate && emailDuplicate.staff_id !== staffId) return { ok: false, message: "This email is already linked to another staff profile." };
  if (existing?.auth_user_id) return { ok: false, message: "This staff profile already has a linked Auth user." };
  const payload = {
    staff_id: staffId,
    full_name: profile.full_name,
    email,
    role,
    active: true,
    access_granted_by: manager.id,
    access_granted_at: new Date().toISOString(),
    disabled_by: null,
    disabled_at: null,
  };
  const { error } = existing
    ? await supabase.from("staff_accounts").update(payload).eq("id", existing.id)
    : await supabase.from("staff_accounts").insert(payload);
  if (error) return { ok: false, message: "Account could not be created." };
  await supabase.from("staff_profiles").update({ email }).eq("id", staffId);
  revalidatePath("/accounts");
  revalidatePath(`/compliance/staff/${staffId}`);
  return { ok: true, message: "Manager access prepared. Send the Supabase Auth invitation, then run the secure linking script." };
}

export async function deactivateStaffAccountAction(_state: ActionResult, formData: FormData): Promise<ActionResult> {
  const manager = await requireAccount(["manager"]);
  const accountId = String(formData.get("accountId") ?? "");
  if (accountId === manager.id) return { ok: false, message: "You cannot disable the account currently in use." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("staff_accounts").update({
    active: false,
    disabled_by: manager.id,
    disabled_at: new Date().toISOString(),
  }).eq("id", accountId);
  if (error) return { ok: false, message: "Account could not be deactivated." };
  revalidatePath("/accounts");
  return { ok: true, message: "Account deactivated." };
}
