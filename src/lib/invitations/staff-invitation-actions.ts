"use server";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { staffInvitationPath } from "./continuation";
export type StaffInvitationAcceptanceActionState = {
  outcome: string;
  message: string;
};
export async function resendStaffInvitationVerificationAction(
  formData: FormData,
) {
  const token = String(formData.get("token") ?? "");
  const next = staffInvitationPath(token);
  if (!next) redirect("/login");
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (data.user?.email)
    await supabase.auth.resend({
      type: "signup",
      email: data.user.email,
      options: {
        emailRedirectTo: process.env.NEXT_PUBLIC_SITE_URL
          ? `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback?next=${encodeURIComponent(next)}`
          : undefined,
      },
    });
  redirect(`${next}&verification=sent`);
}
export async function acceptStaffInvitationAction(
  _state: StaffInvitationAcceptanceActionState,
  formData: FormData,
): Promise<StaffInvitationAcceptanceActionState> {
  const token = String(formData.get("token") ?? "");
  if (!staffInvitationPath(token))
    return {
      outcome: "unavailable",
      message: "This invitation link is not available.",
    };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("accept_staff_invitation", {
    invitation_token: token,
  });
  if (error || !data)
    return {
      outcome: "unavailable",
      message: "The invitation could not be confirmed. Nothing was changed.",
    };
  const outcome = (data as { outcome: string }).outcome;
  return {
    outcome,
    message: ["accepted", "already_linked"].includes(outcome)
      ? "Your login is linked to your staff profile."
      : "",
  };
}
