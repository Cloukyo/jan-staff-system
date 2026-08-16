import { describe, expect, it, vi } from "vitest";
import { createStripeBillingProvider } from "@/lib/billing/stripe-provider";
import Stripe from "stripe";

describe("Stripe billing provider adapter", () => {
  it("creates hosted checkout from a server-selected price and durable idempotency key", async () => {
    const create = vi.fn().mockResolvedValue({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/test" });
    const provider = createStripeBillingProvider({
      checkoutCreate: create,
      portalCreate: vi.fn(),
      customerCreate: vi.fn(),
      subscriptionRetrieve: vi.fn(),
      subscriptionUpdate: vi.fn(),
      webhookConstruct: vi.fn(),
    });
    await expect(provider.createCheckoutSession({
      customerId: "cus_test_1",
      priceId: "price_test_standard_v1",
      organisationId: "65000000-0000-4000-8000-000000000001",
      successUrl: "https://preview.example.invalid/admin/billing?checkout=complete",
      cancelUrl: "https://preview.example.invalid/admin/billing?checkout=cancelled",
      idempotencyKey: "billing-checkout-65000000-0000-4000-8000-000000000001-1",
    })).resolves.toEqual({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/test" });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ mode: "subscription", customer: "cus_test_1" }),
      { idempotencyKey: "billing-checkout-65000000-0000-4000-8000-000000000001-1" });
  });

  it("does not accept an unsigned webhook payload", () => {
    const provider = createStripeBillingProvider({
      checkoutCreate: vi.fn(), portalCreate: vi.fn(), customerCreate: vi.fn(), subscriptionRetrieve: vi.fn(),
      subscriptionUpdate: vi.fn(), webhookConstruct: vi.fn(() => { throw new Error("bad signature"); }),
    });
    expect(() => provider.verifyWebhook("{}", "forged", "whsec_test")).toThrow("Billing webhook signature verification failed");
  });

  it("verifies an official Stripe test signature and emits only the safe provider-neutral event", () => {
    const secret = "whsec_fictional_test_signature";
    const payload = JSON.stringify({ id: "evt_test_signed", object: "event", type: "invoice.paid", created: 1786723200, livemode: false,
      data: { object: { id: "in_test_signed", object: "invoice", customer: "cus_test_signed",
        amount_paid: 4900,
        parent: { subscription_details: { subscription: "sub_test_signed" } },
        lines: { data: [{ period: { start: 1786723200, end: 1789401600 }, pricing: { price_details: { price: "price_test_signed" } } }] } } } });
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret, timestamp: Math.floor(Date.now() / 1000) });
    const provider = createStripeBillingProvider({ checkoutCreate: vi.fn(), portalCreate: vi.fn(), customerCreate: vi.fn(),
      subscriptionRetrieve: vi.fn(), subscriptionUpdate: vi.fn(), webhookConstruct: (body, header, signingSecret) => Stripe.webhooks.constructEvent(body, header, signingSecret) });
    expect(provider.verifyWebhook(payload, signature, secret)).toEqual({
      id: "evt_test_signed", type: "invoice.paid", created: 1786723200, livemode: false, objectId: "in_test_signed",
      customerId: "cus_test_signed", subscriptionId: "sub_test_signed", providerState: null,
      periodStart: 1786723200, periodEnd: 1789401600, cancelAtPeriodEnd: null, priceId: "price_test_signed",
      amountPaid: 4900,
    });
  });

  it("drops a zero-length invoice-line period instead of forwarding invalid billing dates", () => {
    const secret = "whsec_fictional_equal_period";
    const payload = JSON.stringify({ id: "evt_test_equal_period", object: "event", type: "invoice.paid", created: 1786723200, livemode: false,
      data: { object: { id: "in_test_equal_period", object: "invoice", customer: "cus_test_equal_period", amount_paid: 200,
        parent: { subscription_details: { subscription: "sub_test_equal_period" } },
        lines: { data: [{ period: { start: 1786723200, end: 1786723200 }, pricing: { price_details: { price: "price_test_equal_period" } } }] } } } });
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret, timestamp: Math.floor(Date.now() / 1000) });
    const provider = createStripeBillingProvider({ checkoutCreate: vi.fn(), portalCreate: vi.fn(), customerCreate: vi.fn(),
      subscriptionRetrieve: vi.fn(), subscriptionUpdate: vi.fn(), webhookConstruct: (body, header, signingSecret) => Stripe.webhooks.constructEvent(body, header, signingSecret) });
    expect(provider.verifyWebhook(payload, signature, secret)).toMatchObject({ periodStart: null, periodEnd: null, amountPaid: 200 });
  });

  it("selects the positive replacement line from a Stripe proration invoice", () => {
    const secret = "whsec_fictional_proration";
    const payload = JSON.stringify({ id: "evt_test_proration", object: "event", type: "invoice.paid", created: 1786723200, livemode: false,
      data: { object: { id: "in_test_proration", object: "invoice", customer: "cus_test_proration", amount_paid: 5000,
        parent: { subscription_details: { subscription: "sub_test_proration" } },
        lines: { data: [
          { amount: -4900, period: { start: 1786723200, end: 1789401600 }, pricing: { price_details: { price: "price_test_old" } } },
          { amount: 9900, period: { start: 1786723200, end: 1789401600 }, pricing: { price_details: { price: "price_test_new" } } },
        ] } } } });
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret, timestamp: Math.floor(Date.now() / 1000) });
    const provider = createStripeBillingProvider({ checkoutCreate: vi.fn(), portalCreate: vi.fn(), customerCreate: vi.fn(),
      subscriptionRetrieve: vi.fn(), subscriptionUpdate: vi.fn(), webhookConstruct: (body, header, signingSecret) => Stripe.webhooks.constructEvent(body, header, signingSecret) });
    expect(provider.verifyWebhook(payload, signature, secret)).toMatchObject({ priceId: "price_test_new", amountPaid: 5000 });
  });
});
