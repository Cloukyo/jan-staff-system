import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("commercial billing UI", () => {
  it("keeps payment collection hosted and explains non-destructive restriction", () => {
    const source = readFileSync(resolve("src/components/billing/billing-page.tsx"), "utf8");
    expect(source).toContain("Stripe&apos;s secure hosted payment pages");
    expect(source).toContain("This application never handles raw card data");
    expect(source).toContain("Nothing will be deleted");
    expect(source).toContain("attendance evidence");
    expect(source).toContain("!snapshot.providerSubscriptionReady");
    expect(source).not.toMatch(/card number|cvc|cvv/i);
    const serverSource = readFileSync(resolve("src/lib/billing/server.ts"), "utf8");
    expect(serverSource).toContain("if (billingSnapshot.providerSubscriptionReady)");
  });

  it("keeps the fictional visual fixture isolated to local and Preview", () => {
    const source = readFileSync(resolve("src/app/visual-commercial-billing-preview/page.tsx"), "utf8");
    expect(source).toContain('["local", "preview"]');
    expect(source).toContain("85000000-0000-4000-8000-000000000001");
  });
});
