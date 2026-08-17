import { afterEach, describe, expect, it } from "vitest";
import { configuredPrice, loadBillingConfiguration } from "@/lib/billing/config";

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

describe("commercial billing environment separation", () => {
  it("accepts Stripe test mode for Preview and resolves only its plan version", () => {
    Object.assign(process.env, { APP_ENV: "preview", STRIPE_SECRET_KEY: "sk_test_fictional", STRIPE_WEBHOOK_SECRET: "whsec_fictional",
      STRIPE_PRICE_MAP_JSON: JSON.stringify({ preview: { preview_standard: { 1: "price_test_standard_v1" } } }) });
    const configuration = loadBillingConfiguration();
    expect(configuredPrice({ planKey: "preview_standard", planVersion: 1 }, configuration)).toBe("price_test_standard_v1");
  });

  it("accepts a least-privilege Stripe sandbox restricted key", () => {
    Object.assign(process.env, { APP_ENV: "staging", STRIPE_SECRET_KEY: "rk_test_fictional", STRIPE_WEBHOOK_SECRET: "whsec_fictional",
      STRIPE_PRICE_MAP_JSON: JSON.stringify({ preview: {}, staging: { preview_standard: { 1: "price_test_standard_v1" } } }) });
    expect(loadBillingConfiguration().environment).toBe("staging");
  });

  it("rejects live secrets in Preview and refuses Production billing in this milestone", () => {
    Object.assign(process.env, { APP_ENV: "preview", STRIPE_SECRET_KEY: ["sk", "live", "forbidden"].join("_"), STRIPE_WEBHOOK_SECRET: "whsec_fictional",
      STRIPE_PRICE_MAP_JSON: JSON.stringify({ preview: { preview_standard: { 1: "price_test_standard_v1" } } }) });
    expect(() => loadBillingConfiguration()).toThrow(/test secret key/i);
    Object.assign(process.env, { APP_ENV: "production", STRIPE_SECRET_KEY: ["sk", "live", "unconfigured"].join("_") });
    expect(() => loadBillingConfiguration()).toThrow();
  });
});
