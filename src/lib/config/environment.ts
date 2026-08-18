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
  const industryProfile = value(env, "NEXT_PUBLIC_INDUSTRY_PROFILE");

  if (appModeValue && !["demo", "production"].includes(appModeValue)) {
    issues.push("APP_MODE must be demo or production.");
  }
  if (industryProfile && !["nursery", "care_home", "tuition_centre", "clinic"].includes(industryProfile)) {
    issues.push("NEXT_PUBLIC_INDUSTRY_PROFILE must be nursery, care_home, tuition_centre or clinic.");
  }
  const logoPath = value(env, "NEXT_PUBLIC_PRODUCT_LOGO_PATH");
  if (logoPath && !logoPath.startsWith("/")) {
    issues.push("NEXT_PUBLIC_PRODUCT_LOGO_PATH must be an application-relative path beginning with /.");
  }
  if (commercialEnvironments.has(appEnvironment) && appMode !== "production") {
    issues.push(`${appEnvironment} requires APP_MODE=production.`);
  }
  const billingValues = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_MAP_JSON"].map((key) => value(env, key));
  if (value(env, "NEXT_PUBLIC_STRIPE_SECRET_KEY") || value(env, "NEXT_PUBLIC_STRIPE_WEBHOOK_SECRET")) {
    issues.push("Stripe secrets must never use a NEXT_PUBLIC_ variable.");
  }
  if (billingValues.some(Boolean) && billingValues.some((configured) => !configured)) {
    issues.push("Stripe billing configuration must include the secret key, webhook secret and environment price map together.");
  }
  const stripeSandboxKey = billingValues[0] && (
    billingValues[0].startsWith("sk_test_") || billingValues[0].startsWith("rk_test_")
  );
  if (["preview", "staging"].includes(appEnvironment) && billingValues[0] && !stripeSandboxKey) {
    issues.push(`${appEnvironment} billing requires a Stripe test secret key.`);
  }
  if (appEnvironment === "production" && billingValues.some(Boolean)) {
    issues.push("Live commercial billing is not enabled in this milestone.");
  }
  if (value(env, "NOTIFICATION_DELIVERY_ENABLED") === "true") {
    if (value(env, "NEXT_PUBLIC_RESEND_API_KEY") || value(env, "NEXT_PUBLIC_CRON_SECRET")) {
      issues.push("Notification delivery secrets must never use a NEXT_PUBLIC_ variable.");
    }
    if (appEnvironment !== "staging") issues.push("Transactional notification delivery is enabled for Commercial Staging only.");
    for (const key of ["RESEND_API_KEY", "RESEND_FROM_ADDRESS", "RESEND_STAGING_RECIPIENT", "CRON_SECRET", "SUPABASE_SERVICE_ROLE_KEY"]) {
      if (!value(env, key)) issues.push(`${key} is required when transactional notification delivery is enabled.`);
    }
    const stagingRecipient = value(env, "RESEND_STAGING_RECIPIENT")?.toLowerCase();
    if (stagingRecipient && !/^(delivered|bounced|complained)(\+[a-z0-9._-]+)?@resend\.dev$/.test(stagingRecipient)) {
      issues.push("RESEND_STAGING_RECIPIENT must be a controlled resend.dev test recipient.");
    }
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
    value(env, "DEPLOYMENT_SHA") ??
    value(env, "VERCEL_GIT_COMMIT_SHA") ??
    value(env, "GITHUB_SHA") ??
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
