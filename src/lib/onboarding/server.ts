import "server-only";

import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { executeOnboardingCommand, type OnboardingServiceResult } from "./service";
import {
  executeOnboardingBootstrapCommand,
  loadOnboardingBootstrap,
} from "./bootstrap-service";
import type { OnboardingBootstrapSnapshot } from "./contracts";

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

function bootstrapDependencies(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>) {
  return {
    rpc: async (
      name: "get_or_create_onboarding_bootstrap" | "execute_onboarding_bootstrap_command",
      parameters?: { command_envelope: unknown },
    ) => {
      const { data, error } = await supabase.rpc(name, parameters);
      return { data, error };
    },
  };
}

export async function loadOnboardingBootstrapServer(): Promise<OnboardingBootstrapSnapshot> {
  const supabase = await createSupabaseServerClient();
  return loadOnboardingBootstrap(bootstrapDependencies(supabase));
}

export async function executeOnboardingBootstrapCommandServer(input: unknown) {
  const supabase = await createSupabaseServerClient();
  return executeOnboardingBootstrapCommand(input, bootstrapDependencies(supabase));
}
