import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(path), "utf8");
}

function sourceOrEmpty(path: string) {
  const resolvedPath = resolve(path);
  return existsSync(resolvedPath) ? readFileSync(resolvedPath, "utf8") : "";
}

describe("role-aware navigation", () => {
  const shell = source("src/components/layout/app-shell.tsx");
  const navigation = sourceOrEmpty("src/lib/navigation/manager-navigation.ts");

  it("separates manager and staff destinations", () => {
    expect(shell).toContain("managerNavigation");
    expect(shell).toContain("staffNavigation");
    expect(shell).toContain('role === "staff" ? staffNavigation : managerNavigation');
  });

  it("uses manager task language", () => {
    expect(navigation).toContain('label: "Home"');
    expect(navigation).toContain('label: "Clock-ins & hours"');
    expect(navigation).toContain('label: "Leave requests"');
    expect(navigation).toContain('label: "Staff records"');
    expect(navigation).toContain('label: "Export pay hours"');
    expect(navigation).toContain('label: "Clocking-in devices"');
    expect(navigation).toContain('label: "Help"');
    expect(navigation).not.toContain('label: "Compliance"');
    expect(navigation).not.toContain('label: "Accounts"');
    expect(navigation).not.toContain('label: "Payroll review"');
  });

  it("provides a sticky mobile Jump to control for page sections", () => {
    const pageNav = sourceOrEmpty("src/components/layout/manager-page-nav.tsx");
    expect(pageNav).toContain("Jump to");
    expect(pageNav).toContain("sticky");
  });

  it("keeps manager-only links out of the staff navigation definition", () => {
    const staffSection = shell.slice(
      shell.indexOf("const staffNavigation"),
      shell.indexOf("export function AppShell"),
    );
    expect(staffSection).toContain('label: "My leave"');
    expect(staffSection).toContain('label: "Request leave"');
    expect(staffSection).toContain('label: "My rota"');
    expect(staffSection).toContain('label: "My attendance"');
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
    expect(actions).toContain('account.role === "manager" ? "/dashboard" : "/my-rota"');
  });

  it("points dashboard setup warnings to the current editing workflows", () => {
    const dashboard = source("src/components/dashboard/production-dashboard.tsx");
    expect(dashboard).toContain('staffMissingKioskPin", label: "Staff missing a kiosk PIN", href: "/settings/kiosk"');
    expect(dashboard).toContain('staffMissingPayArrangement", label: "Missing active pay arrangement", href: "/payroll/arrangements"');
  });
});
