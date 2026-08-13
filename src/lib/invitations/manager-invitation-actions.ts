"use server";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { managerInvitationPath } from "./continuation";
export type InvitationAcceptanceActionState = {
  outcome: string;
  message: string;
};
export async function resendManagerInvitationVerificationAction(
  formData: FormData,
): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const next = managerInvitationPath(token);
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
export async function acceptManagerInvitationAction(
  _state: InvitationAcceptanceActionState,
  formData: FormData,
): Promise<InvitationAcceptanceActionState> {
  const token = String(formData.get("token") ?? "");
  const next = managerInvitationPath(token);
  if (!next)
    return {
      outcome: "unavailable",
      message: "This invitation link is not available.",
    };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("accept_manager_invitation", {
    invitation_token: token,
  });
  if (error || !data)
    return {
      outcome: "unavailable",
      message: "The invitation could not be confirmed. Nothing was changed.",
    };
  const result = data as { outcome: string };
  if (result.outcome === "mfa_required")
    redirect(`/mfa?next=${encodeURIComponent(next)}`);
  return {
    outcome: result.outcome,
    message:
      result.outcome === "accepted" || result.outcome === "already_accepted"
        ? "Invitation accepted. Your access is ready."
        : "",
  };
}
