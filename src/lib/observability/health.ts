import packageMetadata from "../../../package.json";
import {
  EnvironmentValidationError,
  validateEnvironment,
} from "@/lib/config/environment";
import { getPlatformBranding } from "@/lib/platform/branding";

type SupabaseHealth = "ready" | "unavailable" | "not_configured";

export type HealthPayload = {
  status: "ok" | "not_ready";
  service: string;
  version: string;
  environment: string;
  deploymentSha: string;
  checkedAt: string;
};

export type ReadinessPayload = HealthPayload & {
  dependencies: {
    configuration: "ready" | "invalid";
    supabaseAuth: SupabaseHealth;
  };
  issues?: string[];
};

function unvalidatedMetadata(env: NodeJS.ProcessEnv) {
  return {
    environment: env.APP_ENV?.trim() || "local",
    deploymentSha:
      env.VERCEL_GIT_COMMIT_SHA?.trim() ||
      env.GITHUB_SHA?.trim() ||
      env.DEPLOYMENT_SHA?.trim() ||
      "development",
  };
}

export function buildLiveness(
  env: NodeJS.ProcessEnv = process.env,
  now = new Date(),
): HealthPayload {
  let metadata = unvalidatedMetadata(env);
  try {
    const validated = validateEnvironment(env);
    metadata = {
      environment: validated.appEnvironment,
      deploymentSha: validated.deploymentSha,
    };
  } catch {
    // Liveness reports that the process runs. Readiness reports configuration failures.
  }
  return {
    status: "ok",
    service: getPlatformBranding(env).serviceIdentifier,
    version: packageMetadata.version,
    environment: metadata.environment,
    deploymentSha: metadata.deploymentSha,
    checkedAt: now.toISOString(),
  };
}

export async function checkReadiness(
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): Promise<{ ready: boolean; payload: ReadinessPayload }> {
  const base = buildLiveness(env);
  let validated;
  try {
    validated = validateEnvironment(env);
  } catch (error) {
    const issues = error instanceof EnvironmentValidationError
      ? error.issues
      : ["Environment validation failed."];
    return {
      ready: false,
      payload: {
        ...base,
        status: "not_ready",
        dependencies: { configuration: "invalid", supabaseAuth: "not_configured" },
        issues,
      },
    };
  }

  if (validated.appMode === "demo") {
    return {
      ready: true,
      payload: {
        ...base,
        dependencies: { configuration: "ready", supabaseAuth: "not_configured" },
      },
    };
  }

  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL!;
  const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  try {
    const response = await fetcher(`${supabaseUrl}/auth/v1/health`, {
      method: "GET",
      headers: { apikey: publishableKey },
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    const ready = response.ok;
    return {
      ready,
      payload: {
        ...base,
        status: ready ? "ok" : "not_ready",
        dependencies: {
          configuration: "ready",
          supabaseAuth: ready ? "ready" : "unavailable",
        },
      },
    };
  } catch {
    return {
      ready: false,
      payload: {
        ...base,
        status: "not_ready",
        dependencies: { configuration: "ready", supabaseAuth: "unavailable" },
      },
    };
  }
}
