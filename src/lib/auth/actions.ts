"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { hasSupabaseConfig } from "@/lib/auth/config";

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
  const { data: account, error: accountError } = await supabase.from("staff_accounts").select("active").eq("auth_user_id", data.user.id).maybeSingle();
  if (accountError || !account?.active) {
    await supabase.auth.signOut();
    return { message: "This account is inactive or has not been linked to a staff record." };
  }
  redirect("/dashboard");
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
    redirectTo: process.env.NEXT_PUBLIC_SITE_URL ? `${process.env.NEXT_PUBLIC_SITE_URL}/login` : undefined,
  });
  if (error) return { message: "Password reset could not be sent. Please ask a manager to check the account." };
  return { message: "If the email is linked to an active account, Supabase will send a reset link." };
}
