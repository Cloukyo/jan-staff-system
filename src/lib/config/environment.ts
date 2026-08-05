export type AppEnvironment = "local" | "preview" | "staging" | "production";
export type ValidatedAppMode = "demo" | "production";

export type ValidatedEnvironment = {
  appEnvironment: AppEnvironment;
  appMode: ValidatedAppMode;
  deploymentSha: string;
  siteHost: string | null;
  supabaseProjectRef: string | null;
};

export class EnvironmentValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid application environment:\n- ${issues.join("\n- ")}`);
    this.name = "EnvironmentValidationError";
    this.issues = issues;
  }
}

const commercialEnvironments = new Set<AppEnvironment>([
  "preview",
  "staging",
  "production",
]);

function value(env: NodeJS.ProcessEnv, key: string): string | null {
  const configured = env[key]?.trim();
  return configured ? configured : null;
}

function parseUrl(
  raw: string | null,
  key: string,
  issues: string[],
): URL | null {
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch {
    issues.push(`${key} must be a valid absolute URL.`);
    return null;
  }
}

function configuredEnvironment(
  env: NodeJS.ProcessEnv,
  issues: string[],
): AppEnvironment {
  const configured = value(env, "APP_ENV");
  if (!configured) {
    if (value(env, "VERCEL")) {
      issues.push("APP_ENV is required for every Vercel deployment.");
    }
    return "local";
  }
  if (["local", "preview", "staging", "production"].includes(configured)) {
    return configured as AppEnvironment;
  }
  issues.push("APP_ENV must be local, preview, staging or production.");
  return "local";
}

export function validateEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): ValidatedEnvironment {
  const issues: string[] = [];
  const appEnvironment = configuredEnvironment(env, issues);
  const appModeValue = value(env, "APP_MODE");
  const appMode: ValidatedAppMode = appModeValue === "production" ? "production" : "demo";

  if (appModeValue && !["demo", "production"].includes(appModeValue)) {
    issues.push("APP_MODE must be demo or production.");
  }
  if (commercialEnvironments.has(appEnvironment) && appMode !== "production") {
    issues.push(`${appEnvironment} requires APP_MODE=production.`);
  }

  const required = commercialEnvironments.has(appEnvironment)
    ? [
        "NEXT_PUBLIC_SITE_URL",
        "NEXT_PUBLIC_SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
        "SUPABASE_PROJECT_REF",
        "PRODUCTION_SUPABASE_PROJECT_REF",
        "PRODUCTION_SITE_HOST",
      ]
    : appMode === "production"
      ? [
          "NEXT_PUBLIC_SITE_URL",
          "NEXT_PUBLIC_SUPABASE_URL",
          "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
          "SUPABASE_PROJECT_REF",
        ]
      : [];
  for (const key of required) {
    if (!value(env, key)) issues.push(`${key} is required.`);
  }

  const siteUrl = parseUrl(value(env, "NEXT_PUBLIC_SITE_URL"), "NEXT_PUBLIC_SITE_URL", issues);
  const supabaseUrl = parseUrl(
    value(env, "NEXT_PUBLIC_SUPABASE_URL"),
    "NEXT_PUBLIC_SUPABASE_URL",
    issues,
  );
  const supabaseProjectRef = value(env, "SUPABASE_PROJECT_REF");
  const productionProjectRef = value(env, "PRODUCTION_SUPABASE_PROJECT_REF");
  const productionSiteHost = value(env, "PRODUCTION_SITE_HOST")?.toLowerCase() ?? null;
  const siteHost = siteUrl?.hostname.toLowerCase() ?? null;

  if (commercialEnvironments.has(appEnvironment) && siteUrl?.protocol !== "https:") {
    issues.push("NEXT_PUBLIC_SITE_URL must use HTTPS outside local development.");
  }
  if (commercialEnvironments.has(appEnvironment) && supabaseUrl?.protocol !== "https:") {
    issues.push("NEXT_PUBLIC_SUPABASE_URL must use HTTPS outside local development.");
  }
  if (
    commercialEnvironments.has(appEnvironment) &&
    supabaseProjectRef &&
    supabaseUrl &&
    supabaseUrl.hostname !== `${supabaseProjectRef}.supabase.co`
  ) {
    issues.push("NEXT_PUBLIC_SUPABASE_URL does not match SUPABASE_PROJECT_REF.");
  }

  const vercelEnvironment = value(env, "VERCEL_ENV");
  if (appEnvironment === "production" && vercelEnvironment && vercelEnvironment !== "production") {
    issues.push("APP_ENV=production requires VERCEL_ENV=production.");
  }
  if (
    ["preview", "staging"].includes(appEnvironment) &&
    vercelEnvironment &&
    !["preview", "development"].includes(vercelEnvironment)
  ) {
    issues.push(`${appEnvironment} must not run with VERCEL_ENV=${vercelEnvironment}.`);
  }

  if (appEnvironment === "production") {
    if (supabaseProjectRef && productionProjectRef && supabaseProjectRef !== productionProjectRef) {
      issues.push("Production must use PRODUCTION_SUPABASE_PROJECT_REF.");
    }
    if (siteHost && productionSiteHost && siteHost !== productionSiteHost) {
      issues.push("Production NEXT_PUBLIC_SITE_URL must match PRODUCTION_SITE_HOST.");
    }
  }

  if (["preview", "staging"].includes(appEnvironment)) {
    if (supabaseProjectRef && productionProjectRef && supabaseProjectRef === productionProjectRef) {
      issues.push(`${appEnvironment} must not use the production Supabase project.`);
    }
    if (siteHost && productionSiteHost && siteHost === productionSiteHost) {
      issues.push(`${appEnvironment} must not use the production site host.`);
    }
  }

  const deploymentSha =
    value(env, "VERCEL_GIT_COMMIT_SHA") ??
    value(env, "GITHUB_SHA") ??
    value(env, "DEPLOYMENT_SHA") ??
    (appEnvironment === "local" ? "development" : null);
  if (!deploymentSha) issues.push("A deployment SHA is required outside local development.");

  if (issues.length) throw new EnvironmentValidationError(issues);

  return {
    appEnvironment,
    appMode,
    deploymentSha: deploymentSha!,
    siteHost,
    supabaseProjectRef,
  };
}
