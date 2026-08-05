import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import type { CommercialIdentityDependencies } from "./identity";
import type { CommercialMembershipSummary } from "@/types/tenancy";

export async function createSupabaseCommercialIdentityDependencies(): Promise<CommercialIdentityDependencies> {
  const supabase = await createSupabaseServerClient();
  return {
    getUser: async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) return null;
      return { id: data.user.id, email: data.user.email ?? null };
    },
    getAal: async () => {
      const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (error) return "aal1";
      return data.currentLevel === "aal2" ? "aal2" : "aal1";
    },
    loadMemberships: async () => {
      const { data, error } = await supabase.rpc("current_commercial_identity_snapshot");
      if (error) throw new Error("commercial_identity_snapshot_unavailable");
      return (Array.isArray(data) ? data : []) as CommercialMembershipSummary[];
    },
  };
}
