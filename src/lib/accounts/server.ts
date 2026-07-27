"use server";

import { revalidatePath } from "next/cache";
import type { AppRole } from "@/types";
import { requireAccount } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { createSupabaseAdminClient, hasSupabaseAdminConfig } from "@/lib/auth/supabase-admin";
import type { ActionResult } from "@/lib/leave/server";

export type ProductionAccountStaffOption = {
  id: string;
  fullName: string;
};

export type ProductionAccountAuditRow = {
  id: string;
  action: string;
  performedByName: string;
};

export type ProductionAccountRow = {
  id: string;
  staffId: string;
  fullName: string;
  email: string;
  role: AppRole;
  active: boolean;
  authUserId: string | null;
  audit: ProductionAccountAuditRow[];
};

type AccountRecord = Omit<ProductionAccountRow, "audit">;

function refreshAccountPaths(staffId?: string) {
  revalidatePath("/accounts");
  if (staffId) revalidatePath(`/compliance/staff/${staffId}`);
}

async function getAccount(accountId: string): Promise<AccountRecord | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("staff_accounts").select("id,staff_id,full_name,email,role,active,auth_user_id").eq("id", accountId).maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    staffId: data.staff_id,
    fullName: data.full_name,
    email: data.email,
    role: data.role,
    active: data.active,
    authUserId: data.auth_user_id,
  };
}

export async function loadProductionAccounts(): Promise<{
  accounts: ProductionAccountRow[];
  staff: ProductionAccountStaffOption[];
  adminConfigured: boolean;
}> {
  await requireAccount(["manager"]);
  const supabase = await createSupabaseServerClient();
  const [accountResult, staffResult, auditResult, managerResult] = await Promise.all([
    supabase.from("staff_accounts").select("id,staff_id,full_name,email,role,active,auth_user_id").order("full_name"),
    supabase.from("staff_profiles").select("id,full_name").eq("active", true).order("full_name"),
    supabase.from("staff_account_access_audit").select("id,staff_account_id,action,performed_by,created_at").order("created_at", { ascending: false }),
    supabase.from("staff_accounts").select("id,full_name"),
  ]);
  if (accountResult.error || staffResult.error) throw new Error("Account access could not be loaded.");
  const managerNames = new Map((managerResult.data ?? []).map((row) => [row.id, row.full_name]));
  const audit = auditResult.error ? [] : auditResult.data ?? [];
  return {
    accounts: (accountResult.data ?? []).map((row) => ({
      id: row.id,
      staffId: row.staff_id,
      fullName: row.full_name,
      email: row.email,
      role: row.role,
      active: row.active,
      authUserId: row.auth_user_id,
      audit: audit.filter((item) => item.staff_account_id === row.id).map((item) => ({
        id: item.id,
        action: item.action,
        performedByName: managerNames.get(item.performed_by) ?? "Manager",
      })),
    })),
    staff: (staffResult.data ?? []).map((row) => ({ id: row.id, fullName: row.full_name })),
    adminConfigured: hasSupabaseAdminConfig(),
  };
}

export async function prepareStaffAccountAction(_state: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireAccount(["manager"]);
  const staffId = String(formData.get("staffId") ?? "");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "staff") as AppRole;
  if (!staffId || !email) return { ok: false, message: "Staff profile and email are required." };
  if (!["manager", "staff"].includes(role)) return { ok: false, message: "Choose a valid role." };
  const supabase = await createSupabaseServerClient();
  const [{ data: profile }, { data: emailDuplicate }, { data: existing }] = await Promise.all([
    supabase.from("staff_profiles").select("id,full_name").eq("id", staffId).maybeSingle(),
    supabase.from("staff_accounts").select("id,staff_id").eq("email", email).maybeSingle(),
    supabase.from("staff_accounts").select("id,auth_user_id").eq("staff_id", staffId).maybeSingle(),
  ]);
  if (!profile) return { ok: false, message: "Choose an existing canonical staff profile." };
  if (emailDuplicate && emailDuplicate.staff_id !== staffId) return { ok: false, message: "This email is already linked to another staff profile." };
  if (existing) return { ok: false, message: existing.auth_user_id ? "This staff profile already has a linked login." : "Account access has already been prepared for this staff profile." };
  const { error } = await supabase.rpc("prepare_staff_account", { p_staff_id: staffId, p_email: email, p_role: role });
  if (error) return { ok: false, message: "Account access could not be prepared." };
  refreshAccountPaths(staffId);
  return { ok: true, message: "Account access prepared. Send the invitation when ready." };
}

export async function inviteStaffAccountAction(_state: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireAccount(["manager"]);
  if (!hasSupabaseAdminConfig()) return { ok: false, message: "Supabase server administration is not configured." };
  const accountId = String(formData.get("accountId") ?? "");
  const account = await getAccount(accountId);
  if (!account) return { ok: false, message: "Account record not found." };
  if (account.authUserId) return { ok: false, message: "This account is already linked to an Auth user." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(account.email, {
    data: { full_name: account.fullName, staff_id: account.staffId },
    redirectTo: process.env.NEXT_PUBLIC_SITE_URL ? `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback` : undefined,
  });
  if (error || !data.user) return { ok: false, message: "The invitation could not be sent. If the Auth user already exists, use Link existing Auth user." };
  const supabase = await createSupabaseServerClient();
  const { error: updateError } = await supabase.rpc("link_staff_auth_user", {
    p_account_id: account.id,
    p_auth_user_id: data.user.id,
    p_action: "invited",
  });
  if (updateError) return { ok: false, message: "The invitation was sent, but the staff account link could not be saved. Link the existing Auth user from this screen." };
  refreshAccountPaths(account.staffId);
  return { ok: true, message: "Invitation sent and linked to the existing staff profile." };
}

export async function linkExistingAuthUserAction(_state: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireAccount(["manager"]);
  if (!hasSupabaseAdminConfig()) return { ok: false, message: "Supabase server administration is not configured." };
  const accountId = String(formData.get("accountId") ?? "");
  const authUserId = String(formData.get("authUserId") ?? "").trim();
  const account = await getAccount(accountId);
  if (!account || !authUserId) return { ok: false, message: "Account record and Auth user UUID are required." };
  if (account.authUserId) return { ok: false, message: "This account is already linked." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.getUserById(authUserId);
  if (error || !data.user) return { ok: false, message: "The Auth user could not be verified." };
  if (data.user.email?.trim().toLowerCase() !== account.email) return { ok: false, message: "The Auth user email does not match this account record." };
  const supabase = await createSupabaseServerClient();
  const { data: duplicate } = await supabase.from("staff_accounts").select("id").eq("auth_user_id", authUserId).neq("id", account.id).maybeSingle();
  if (duplicate) return { ok: false, message: "This Auth user is already linked to another staff profile." };
  const { error: updateError } = await supabase.rpc("link_staff_auth_user", {
    p_account_id: account.id,
    p_auth_user_id: authUserId,
    p_action: "linked",
  });
  if (updateError) return { ok: false, message: "The Auth user could not be linked." };
  refreshAccountPaths(account.staffId);
  return { ok: true, message: "Existing Auth user verified and linked." };
}

export async function updateStaffAccountRoleAction(_state: ActionResult, formData: FormData): Promise<ActionResult> {
  const manager = await requireAccount(["manager"]);
  const accountId = String(formData.get("accountId") ?? "");
  const role = String(formData.get("role") ?? "") as AppRole;
  if (!["manager", "staff"].includes(role)) return { ok: false, message: "Choose a valid role." };
  const account = await getAccount(accountId);
  if (!account) return { ok: false, message: "Account not found." };
  if (account.id === manager.id && role !== "manager") return { ok: false, message: "You cannot remove your own manager access." };
  if (account.role === role) return { ok: true, message: "Role is already up to date." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_staff_account_role", { p_account_id: account.id, p_role: role });
  if (error) return { ok: false, message: "Role could not be updated." };
  refreshAccountPaths(account.staffId);
  return { ok: true, message: "Account role updated." };
}

export async function deactivateStaffAccountAction(_state: ActionResult, formData: FormData): Promise<ActionResult> {
  const manager = await requireAccount(["manager"]);
  const accountId = String(formData.get("accountId") ?? "");
  if (accountId === manager.id) return { ok: false, message: "You cannot disable the account currently in use." };
  const account = await getAccount(accountId);
  if (!account) return { ok: false, message: "Account not found." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_staff_account_active", { p_account_id: accountId, p_active: false });
  if (error) return { ok: false, message: "Account could not be disabled." };
  refreshAccountPaths(account.staffId);
  return { ok: true, message: "Account disabled. Staff history remains intact." };
}

export async function reactivateStaffAccountAction(_state: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireAccount(["manager"]);
  const accountId = String(formData.get("accountId") ?? "");
  const account = await getAccount(accountId);
  if (!account) return { ok: false, message: "Account not found." };
  const supabase = await createSupabaseServerClient();
  const { data: profile } = await supabase.from("staff_profiles").select("active").eq("id", account.staffId).maybeSingle();
  if (profile?.active !== true) return { ok: false, message: "Reactivate the staff profile before enabling login." };
  const { error } = await supabase.rpc("set_staff_account_active", { p_account_id: accountId, p_active: true });
  if (error) return { ok: false, message: "Account could not be enabled." };
  refreshAccountPaths(account.staffId);
  return { ok: true, message: "Account enabled." };
}
