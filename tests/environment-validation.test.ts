import { describe, expect, it } from "vitest";
import {
  EnvironmentValidationError,
  validateEnvironment,
} from "@/lib/config/environment";

function productionEnvironment(
  overrides: Partial<NodeJS.ProcessEnv> = {},
): NodeJS.ProcessEnv {
  const baseline: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
    APP_ENV: "production",
    APP_MODE: "production",
    VERCEL: "1",
    VERCEL_ENV: "production",
    NEXT_PUBLIC_SITE_URL: "https://staff.example.com",
    NEXT_PUBLIC_SUPABASE_URL: "https://prodref.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
    SUPABASE_PROJECT_REF: "prodref",
    PRODUCTION_SUPABASE_PROJECT_REF: "prodref",
    PRODUCTION_SITE_HOST: "staff.example.com",
    VERCEL_GIT_COMMIT_SHA: "0123456789abcdef0123456789abcdef01234567",
  };
  return { ...baseline, ...overrides };
}

describe("commercial environment validation", () => {
  it("allows local demo development without external credentials", () => {
    expect(validateEnvironment({ NODE_ENV: "development" })).toMatchObject({
      appEnvironment: "local",
      appMode: "demo",
      deploymentSha: "development",
    });
  });

  it("rejects an unknown industry profile and a non-relative logo path", () => {
    expect(() => validateEnvironment({
      NODE_ENV: "development",
      NEXT_PUBLIC_INDUSTRY_PROFILE: "unknown",
      NEXT_PUBLIC_PRODUCT_LOGO_PATH: "https://example.com/logo.png",
    })).toThrow("NEXT_PUBLIC_INDUSTRY_PROFILE must be nursery, care_home, tuition_centre or clinic");
  });

  it("allows an explicit local production mode with the local Supabase stack", () => {
    expect(
      validateEnvironment({
        NODE_ENV: "development",
        APP_ENV: "local",
        APP_MODE: "production",
        NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "local-publishable-key",
        SUPABASE_PROJECT_REF: "local",
      }),
    ).toMatchObject({
      appEnvironment: "local",
      appMode: "production",
      supabaseProjectRef: "local",
    });
  });

  it("accepts an explicitly matched production environment", () => {
    expect(validateEnvironment(productionEnvironment())).toMatchObject({
      appEnvironment: "production",
      appMode: "production",
      supabaseProjectRef: "prodref",
      siteHost: "staff.example.com",
    });
  });

  it("accepts an isolated preview environment", () => {
    expect(
      validateEnvironment(
        productionEnvironment({
          APP_ENV: "preview",
          VERCEL_ENV: "preview",
          NEXT_PUBLIC_SITE_URL: "https://feature.example-preview.com",
          NEXT_PUBLIC_SUPABASE_URL: "https://previewref.supabase.co",
          SUPABASE_PROJECT_REF: "previewref",
        }),
      ),
    ).toMatchObject({
      appEnvironment: "preview",
      supabaseProjectRef: "previewref",
    });
  });

  it("reports all missing commercial deployment variables together", () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: "production",
        APP_ENV: "staging",
        APP_MODE: "production",
      }),
    ).toThrowError(EnvironmentValidationError);

    try {
      validateEnvironment({
        NODE_ENV: "production",
        APP_ENV: "staging",
        APP_MODE: "production",
      });
    } catch (error) {
      expect((error as Error).message).toContain("NEXT_PUBLIC_SITE_URL");
      expect((error as Error).message).toContain("SUPABASE_PROJECT_REF");
      expect((error as Error).message).toContain("PRODUCTION_SUPABASE_PROJECT_REF");
    }
  });

  it("rejects a production URL whose Supabase project does not match", () => {
    expect(() =>
      validateEnvironment(
        productionEnvironment({
          NEXT_PUBLIC_SUPABASE_URL: "https://otherref.supabase.co",
        }),
      ),
    ).toThrow("does not match SUPABASE_PROJECT_REF");
  });

  it("rejects preview use of the production site or database", () => {
    expect(() =>
      validateEnvironment(
        productionEnvironment({
          APP_ENV: "preview",
          VERCEL_ENV: "preview",
        }),
      ),
    ).toThrow("must not use the production Supabase project");
  });

  it("rejects a production deployment labelled as preview", () => {
    expect(() =>
      validateEnvironment(
        productionEnvironment({
          VERCEL_ENV: "preview",
        }),
      ),
    ).toThrow("APP_ENV=production requires VERCEL_ENV=production");
  });

  it("keeps billing secrets server-only and Preview test-mode only", () => {
    expect(() => validateEnvironment(productionEnvironment({
      APP_ENV: "preview", VERCEL_ENV: "preview", NEXT_PUBLIC_SITE_URL: "https://feature.example-preview.com",
      NEXT_PUBLIC_SUPABASE_URL: "https://previewref.supabase.co", SUPABASE_PROJECT_REF: "previewref",
      NEXT_PUBLIC_STRIPE_SECRET_KEY: "forbidden",
    }))).toThrow("must never use a NEXT_PUBLIC_ variable");
    expect(() => validateEnvironment(productionEnvironment({
      APP_ENV: "preview", VERCEL_ENV: "preview", NEXT_PUBLIC_SITE_URL: "https://feature.example-preview.com",
      NEXT_PUBLIC_SUPABASE_URL: "https://previewref.supabase.co", SUPABASE_PROJECT_REF: "previewref",
      STRIPE_SECRET_KEY: "sk_live_forbidden", STRIPE_WEBHOOK_SECRET: "whsec_fictional",
      STRIPE_PRICE_MAP_JSON: "{}",
    }))).toThrow("requires a Stripe test secret key");
  });
});
