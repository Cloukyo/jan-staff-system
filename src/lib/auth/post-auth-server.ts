import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { resolveAuthenticatedCommercialIdentity } from "@/lib/commercial-identity/identity";
import { clearCommercialPreference, writeCommercialPreference } from "@/lib/commercial-identity/session";
import { createSupabaseCommercialIdentityDependencies } from "@/lib/commercial-identity/supabase-store";
import { safeCommercialContinuation as safeInvitationContinuation } from "@/lib/invitations/continuation";
import { loadOnboardingBootstrap } from "@/lib/onboarding/bootstrap-service";
import { authoritativeOnboardingRoute } from "@/lib/onboarding/navigation";
import {
  resolvePostAuthDestination,
  type LegacyPostAuthAccount,
  type PostAuthDestination,
} from "./post-auth-destination";

export async function resolvePostAuthDestinationServer(
  requestedContinuation?: string | null,
): Promise<PostAuthDestination> {
  const supabase = await createSupabaseServerClient();
  const identity = await resolveAuthenticatedCommercialIdentity(
    await createSupabaseCommercialIdentityDependencies(),
  );
  const accountResult = await supabase
    .from("staff_accounts")
    .select("active,must_change_password,role")
    .eq("auth_user_id", identity.authUserId)
    .maybeSingle();
  if (accountResult.error) throw new Error("Authenticated account state could not be loaded.");

  const legacyAccount: LegacyPostAuthAccount | null = accountResult.data
    ? {
        active: accountResult.data.active,
        mustChangePassword: accountResult.data.must_change_password,
        role: accountResult.data.role,
      }
    : null;
  const requestedInvitation = safeInvitationContinuation(requestedContinuation);
  let onboardingDestination: string | null = null;
  if (identity.memberships.length === 0 && !legacyAccount && !requestedInvitation?.startsWith("/invitations/")) {
    const snapshot = await loadOnboardingBootstrap({
      rpc: async (name, parameters) => await supabase.rpc(name, parameters),
    });
    onboardingDestination = authoritativeOnboardingRoute(snapshot);
  }

  return resolvePostAuthDestination({
    identity,
    legacyAccount,
    onboardingDestination,
    requestedContinuation,
  });
}

export async function applyPostAuthDestination(decision: PostAuthDestination): Promise<string> {
  if (decision.clearCommercialPreference) await clearCommercialPreference();
  if (decision.commercialPreference) await writeCommercialPreference(decision.commercialPreference);
  if (decision.signOut) await (await createSupabaseServerClient()).auth.signOut();
  return decision.destination;
}

export async function resolveAndApplyPostAuthDestination(
  requestedContinuation?: string | null,
): Promise<string> {
  return applyPostAuthDestination(await resolvePostAuthDestinationServer(requestedContinuation));
}
