import { createSupabaseServerClient } from "@/lib/auth/supabase-server";

export type InvitationAcceptanceOutcome = "accepted" | "already_accepted" | "authentication_required" | "mfa_required" | "unavailable";

export function mapInvitationAcceptanceError(error: unknown): InvitationAcceptanceOutcome {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("commercial_invitation_mfa_required") ? "mfa_required" : "unavailable";
}

export async function acceptCommercialInvitation(token: string): Promise<InvitationAcceptanceOutcome> {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return "authentication_required";
  const { data, error } = await supabase.rpc("accept_organisation_invitation", { invitation_token: token });
  if (error) return mapInvitationAcceptanceError(error);
  const row = Array.isArray(data) ? data[0] : data;
  return row?.outcome === "already_accepted" ? "already_accepted" : "accepted";
}
