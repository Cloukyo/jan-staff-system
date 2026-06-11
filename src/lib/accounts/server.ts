"use server";

import { revalidatePath } from "next/cache";
import type { AppRole } from "@/types";
import { requireAccount } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import type { ActionResult } from "@/lib/leave/server";

export async function createStaffAccountAction(_state: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireAccount(["manager"]);
  const staffId = String(formData.get("staffId") ?? "");
  const fullName = String(formData.get("fullName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "staff") as AppRole;
  if (!staffId || !fullName || !email) return { ok: false, message: "Staff member, name and email are required." };
  if (!["manager", "staff"].includes(role)) return { ok: false, message: "Choose a valid role." };
  const supabase = await createSupabaseServerClient();
  const { data: duplicate } = await supabase.from("staff_accounts").select("id").or(`staff_id.eq.${staffId},email.eq.${email}`).limit(1);
  if (duplicate?.length) return { ok: false, message: "An account already exists for this staff member or email." };
  const { error } = await supabase.from("staff_accounts").insert({ staff_id: staffId, full_name: fullName, email, role, active: true });
  if (error) return { ok: false, message: "Account could not be created." };
  revalidatePath("/accounts");
  return { ok: true, message: "Account link created. Invite the user in Supabase Auth, then set auth_user_id on this account." };
}

export async function deactivateStaffAccountAction(_state: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireAccount(["manager"]);
  const accountId = String(formData.get("accountId") ?? "");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("staff_accounts").update({ active: false }).eq("id", accountId);
  if (error) return { ok: false, message: "Account could not be deactivated." };
  revalidatePath("/accounts");
  return { ok: true, message: "Account deactivated." };
}
