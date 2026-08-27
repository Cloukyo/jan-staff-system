"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "./supabase-server";

export type MfaActionState = {
  stage: "ready" | "enrolment";
  factorId: string | null;
  qrCode: string | null;
  secret: string | null;
  message: string;
};

export async function startMfaEnrollmentAction(state: MfaActionState): Promise<MfaActionState> {
  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return { ...state, message: "Your session has expired. Sign in and try again." };
  const result = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "Commercial owner authenticator",
  });
  if (result.error) return { ...state, message: "Authenticator setup could not be started. Try again." };
  return {
    stage: "enrolment",
    factorId: result.data.id,
    qrCode: result.data.totp.qr_code,
    secret: result.data.totp.secret,
    message: "",
  };
}

export async function verifyMfaAction(state: MfaActionState, formData: FormData): Promise<MfaActionState> {
  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return { ...state, message: "Your session has expired. Sign in and try again." };
  let factorId = String(formData.get("factorId") ?? "") || state.factorId;
  if (!factorId) {
    const factors = await supabase.auth.mfa.listFactors();
    factorId = factors.data?.totp.find((factor) => factor.status === "verified")?.id ?? null;
  }
  const code = String(formData.get("code") ?? "").replace(/\D/g, "").slice(0, 6);
  if (!factorId || !/^\d{6}$/.test(code)) {
    return { ...state, message: "Enter the current six-digit code from your authenticator app." };
  }
  const result = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (result.error) return { ...state, message: "That code was not accepted. Wait for a new code and try again." };
  const requested = String(formData.get("nextPath") ?? "");
  redirect(requested === "/onboarding/organisation" ? requested : "/onboarding");
}
