import "server-only";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
export type StaffInvitationInspection = {
  state: string;
  organisationName?: string;
  expiresAt?: string;
  requiresMfa?: boolean;
};
export async function inspectStaffInvitationServer(
  token: string,
): Promise<StaffInvitationInspection> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("inspect_staff_invitation", {
    invitation_token: token,
  });
  return error || !data || typeof data !== "object"
    ? { state: "unavailable" }
    : (data as StaffInvitationInspection);
}
export async function currentStaffInvitationIdentityServer() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return {
    authenticated: Boolean(data.user),
    emailVerified: Boolean(data.user?.email_confirmed_at),
  };
}
