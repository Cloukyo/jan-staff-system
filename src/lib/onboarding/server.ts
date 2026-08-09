import "server-only";

import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { executeOnboardingCommand, type OnboardingServiceResult } from "./service";

/**
 * Authenticated server boundary for the onboarding foundation transaction.
 * The database resolves actor membership, tenant access and readiness from the
 * request's Supabase session. No service-role or client-supplied tenant context
 * is used here.
 */
export async function executeOnboardingCommandServer(
  input: unknown,
): Promise<OnboardingServiceResult> {
  const supabase = await createSupabaseServerClient();

  return executeOnboardingCommand(input, {
    rpc: async (name, parameters) => {
      const { data, error } = await supabase.rpc(name, parameters);
      return { data, error };
    },
  });
}
