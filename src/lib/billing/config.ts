import { stripePriceConfigurationSchema } from "./contracts";

export type BillingEnvironment = "preview" | "staging" | "production";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for commercial billing.`);
  return value;
}

export function loadBillingConfiguration() {
  const appEnvironment = process.env.APP_ENV;
  if (!appEnvironment || !["preview", "staging", "production"].includes(appEnvironment)) {
    throw new Error("Commercial billing is available only in an explicitly separated commercial environment.");
  }
  const environment = appEnvironment as BillingEnvironment;
  const secretKey = required("STRIPE_SECRET_KEY");
  const webhookSecret = required("STRIPE_WEBHOOK_SECRET");
  if (environment !== "production" && !secretKey.startsWith("sk_test_")) throw new Error("Preview and staging billing require a Stripe test secret key.");
  if (environment !== "production" && !webhookSecret.startsWith("whsec_")) throw new Error("A Stripe test webhook signing secret is required.");
  if (environment === "production") throw new Error("Live commercial billing is not enabled in this milestone.");
  let rawPrices: unknown;
  try { rawPrices = JSON.parse(required("STRIPE_PRICE_MAP_JSON")); } catch { throw new Error("STRIPE_PRICE_MAP_JSON must be valid environment-scoped JSON."); }
  const prices = stripePriceConfigurationSchema.parse(rawPrices);
  return { environment, secretKey, webhookSecret, prices: prices[environment] ?? {} };
}

export function configuredPrice(input: { planKey: string; planVersion: number }, configuration = loadBillingConfiguration()): string {
  const price = configuration.prices[input.planKey]?.[input.planVersion];
  if (!price) throw new Error("The selected commercial plan has no price in this environment.");
  return price;
}
