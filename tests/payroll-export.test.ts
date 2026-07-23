import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(path), "utf8");
}

describe("payroll export confirmation policy", () => {
  it("allows incomplete attendance only after explicit manager confirmation", () => {
    const route = source("src/app/payroll/export/route.ts");

    expect(route).toContain('params.get("confirmUnreviewed") === "1"');
    expect(route).toMatch(
      /if \(\(readiness\.unresolved > 0 \|\| readiness\.pendingRequests > 0\) && !confirmUnreviewed\)/,
    );
    expect(route).toContain("Confirm the unreviewed payroll export before downloading.");
    expect(route).toContain('requireAccount(["manager"])');
  });
});

describe("payroll export confirmation interface", () => {
  it("keeps export available and confirms incomplete attendance inline", () => {
    const screen = source("src/components/payroll/production-payroll-screen.tsx");

    expect(screen).not.toContain(
      "disabled={reviewReadiness.unresolved > 0 || reviewReadiness.pendingRequests > 0}",
    );
    expect(screen).toContain('confirmUnreviewed: confirmed ? "1" : "0"');
    expect(screen).toContain("Export unreviewed Excel");
    expect(screen).toContain("These hours may be inaccurate");
    expect(screen).toContain('role="alert"');
  });
});
