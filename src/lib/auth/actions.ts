"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { hasSupabaseConfig } from "@/lib/auth/config";
import { validatePrivatePassword } from "@/lib/auth/password-validation";

export type AuthActionState = {
  message: string;
};

export async function signInAction(_state: AuthActionState, formData: FormData): Promise<AuthActionState> {
  if (!hasSupabaseConfig()) return { message: "Supabase is not configured. Add the environment variables before using production login." };
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { message: "Enter your email address and password." };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) return { message: "The email or password was not recognised." };
  const { data: account, error: accountError } = await supabase.from("staff_accounts").select("active,must_change_password,role").eq("auth_user_id", data.user.id).maybeSingle();
  if (accountError || !account?.active) {
    await supabase.auth.signOut();
    return { message: "This account is inactive or has not been linked to a staff record." };
  }
  redirect(account.must_change_password ? "/change-password" : account.role === "manager" ? "/dashboard" : "/leave");
}

export type ChangePasswordActionState = {
  ok: boolean;
  message: string;
};

async function updateCurrentUserPassword(password: string, confirmation: string): Promise<ChangePasswordActionState> {
  if (!hasSupabaseConfig()) return { ok: false, message: "Supabase is not configured." };
  if (password !== confirmation) return { ok: false, message: "The password confirmation does not match." };

  const supabase = await createSupabaseServerClient();
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user?.email) return { ok: false, message: "Your password-reset session has expired. Request a new reset email." };
  const validation = validatePrivatePassword(password, userResult.user.email);
  if (validation) return { ok: false, message: validation };

  const { error: passwordError } = await supabase.auth.updateUser({ password });
  if (passwordError) return { ok: false, message: "The new password could not be saved. Request a new reset email and try again." };

  return { ok: true, message: "" };
}

export async function changeRequiredPasswordAction(
  _state: ChangePasswordActionState,
  formData: FormData,
): Promise<ChangePasswordActionState> {
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");
  const result = await updateCurrentUserPassword(password, confirmation);
  if (!result.ok) return result;

  const supabase = await createSupabaseServerClient();
  const { error: flagError } = await supabase.rpc("complete_required_password_change");
  if (flagError) return { ok: false, message: "The password changed, but the account flag could not be cleared. Please submit the new password again." };
  const { data: account } = await supabase.from("staff_accounts").select("role").eq("auth_user_id", (await supabase.auth.getUser()).data.user?.id ?? "").maybeSingle();
  redirect(account?.role === "manager" ? "/dashboard" : "/leave");
}

export async function resetRecoveredPasswordAction(
  _state: ChangePasswordActionState,
  formData: FormData,
): Promise<ChangePasswordActionState> {
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");
  const result = await updateCurrentUserPassword(password, confirmation);
  if (!result.ok) return result;

  const supabase = await createSupabaseServerClient();
  const { error: flagError } = await supabase.rpc("complete_required_password_change");
  if (flagError) return { ok: false, message: "The password changed, but the account could not be finalised. Please contact a manager." };
  await supabase.auth.signOut();
  redirect("/login?password-reset=success");
}

export async function signOutAction() {
  if (hasSupabaseConfig()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  redirect("/login");
}

export async function resetPasswordAction(_state: AuthActionState, formData: FormData): Promise<AuthActionState> {
  if (!hasSupabaseConfig()) return { message: "Supabase is not configured. Add the environment variables before sending reset emails." };
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) return { message: "Enter your email address first." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: process.env.NEXT_PUBLIC_SITE_URL ? `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback?next=/reset-password` : undefined,
  });
  if (error) {
    console.error("Supabase password reset failed", { code: error.code, status: error.status });
    if (error.status === 429) {
      return { message: "Too many reset emails have been requested. Wait a few minutes, then request one new email and use only the newest link." };
    }
    return { message: "Password reset could not be sent. Please ask a manager to check the account." };
  }
  return { message: "If the email is linked to an active account, Supabase will send a reset link." };
}
