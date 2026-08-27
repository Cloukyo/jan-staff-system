import "server-only";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
export type InvitationInspection = {
  state: string;
  organisationName?: string;
  roleLabel?: string;
  expiresAt?: string;
  requiresMfa?: boolean;
};
export async function inspectManagerInvitationServer(
  token: string,
): Promise<InvitationInspection> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("inspect_manager_invitation", {
    invitation_token: token,
  });
  if (error || !data || typeof data !== "object")
    return { state: "unavailable" };
  return data as InvitationInspection;
}
export async function currentInvitationIdentityServer() {
  const supabase = await createSupabaseServerClient();
  const [{ data: user }, { data: assurance }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);
  return {
    authenticated: Boolean(user.user),
    emailVerified: Boolean(user.user?.email_confirmed_at),
    assuranceLevel: assurance?.currentLevel ?? "aal1",
  };
}
