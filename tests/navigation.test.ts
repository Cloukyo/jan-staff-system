import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(path), "utf8");
}

describe("role-aware navigation", () => {
  const shell = source("src/components/layout/app-shell.tsx");

  it("separates manager and staff destinations", () => {
    expect(shell).toContain("managerNavigation");
    expect(shell).toContain("staffNavigation");
    expect(shell).toContain('role === "staff" ? staffNavigation : managerNavigation');
    expect(shell).toContain('label: "Pay arrangements"');
    expect(shell).toContain('label: "Kiosk setup"');
  });

  it("keeps manager-only links out of the staff navigation definition", () => {
    const staffSection = shell.slice(shell.indexOf("const staffNavigation"), shell.indexOf("function itemIsActive"));
    expect(staffSection).toContain('label: "My leave"');
    expect(staffSection).toContain('label: "Request leave"');
    expect(staffSection).toContain('label: "Profile"');
    expect(staffSection).not.toContain("/payroll");
    expect(staffSection).not.toContain("/compliance");
    expect(staffSection).not.toContain("/accounts");
  });

  it("supports accessible mobile navigation and short screens", () => {
    expect(shell).toContain('aria-label="Close navigation"');
    expect(shell).toContain('event.key === "Escape"');
    expect(shell).toContain('event.key !== "Tab"');
    expect(shell).toContain("menuButton?.focus()");
    expect(shell).toContain("overflow-y-auto");
    expect(shell).not.toContain("absolute bottom-5");
  });

  it("redirects staff directly to their own production area", () => {
    const actions = source("src/lib/auth/actions.ts");
    expect(actions).toContain('account.role === "manager" ? "/dashboard" : "/leave"');
  });

  it("points dashboard setup warnings to the current editing workflows", () => {
    const dashboard = source("src/components/dashboard/production-dashboard.tsx");
    expect(dashboard).toContain('staffMissingKioskPin", label: "Staff missing a kiosk PIN", href: "/attendance"');
    expect(dashboard).toContain('staffMissingPayArrangement", label: "Missing active pay arrangement", href: "/payroll/arrangements"');
  });
});
