import { redirect } from "next/navigation";
import type { AppRole, StaffAccount } from "@/types";
import { hasSupabaseConfig } from "@/lib/auth/config";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";

type StaffAccountRow = {
  id: string;
  auth_user_id: string | null;
  staff_id: string;
  full_name: string;
  email: string;
  role: AppRole;
  active: boolean;
  must_change_password: boolean;
  created_at: string;
  updated_at: string;
};

export function mapStaffAccount(row: StaffAccountRow): StaffAccount {
  return {
    id: row.id,
    authUserId: row.auth_user_id,
    staffId: row.staff_id,
    fullName: row.full_name,
    email: row.email,
    role: row.role,
    active: row.active,
    mustChangePassword: row.must_change_password,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getCurrentAccount(): Promise<StaffAccount | null> {
  if (!hasSupabaseConfig()) return null;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.from("staff_accounts").select("*").eq("auth_user_id", user.id).maybeSingle();
  if (error || !data) return null;
  const account = mapStaffAccount(data as StaffAccountRow);
  return account.active ? account : null;
}

export async function requireAccount(roles?: AppRole[]): Promise<StaffAccount> {
  const account = await getCurrentAccount();
  if (!account) redirect("/login");
  if (account.mustChangePassword) redirect("/change-password");
  if (roles?.length && !roles.includes(account.role)) redirect(account.role === "manager" ? "/dashboard" : "/leave");
  return account;
}

export function canAccessStaffRecord(account: StaffAccount, staffId: string): boolean {
  return account.role === "manager" || account.staffId === staffId;
}
