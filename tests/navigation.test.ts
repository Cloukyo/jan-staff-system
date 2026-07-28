import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { itemIsActive, managerNavigation } from "@/lib/navigation/manager-navigation";

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

  it("keeps staff and pay context active on their child workflows", () => {
    const items = managerNavigation.flatMap((group) => group.items);
    const staff = items.find((item) => item.label === "Staff records");
    const pay = items.find((item) => item.label === "Export pay hours");

    expect(staff && itemIsActive(staff, "/compliance/staff/staff-1")).toBe(true);
    expect(pay && itemIsActive(pay, "/payroll")).toBe(true);
    expect(pay && itemIsActive(pay, "/payroll/review")).toBe(true);
    expect(pay && itemIsActive(pay, "/payroll/arrangements")).toBe(true);
  });

  it("provides a sticky mobile Jump to control for page sections", () => {
    const pageNav = sourceOrEmpty("src/components/layout/manager-page-nav.tsx");
    expect(pageNav).toContain("Jump to");
    expect(pageNav).toContain("sticky");
  });

  it("uses familiar names across remaining manager pages", () => {
    const dashboard = source("src/components/dashboard/production-dashboard.tsx");
    const rota = source("src/components/rota/production-rota.tsx");
    const settings = source("src/components/settings/production-settings.tsx");
    const help = source("src/lib/help/manager-help.ts");

    expect(dashboard).toContain(">Home<");
    expect(settings).toContain("Nursery settings");
    expect(help).toContain('href: "/rota"');
    for (const managerFile of [dashboard, rota, settings]) {
      expect(managerFile).not.toMatch(/Production data|Supabase/);
    }
    expect(settings).not.toMatch(/canonical|Auth|UUID/);
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
    expect(dashboard).toContain('staffMissingKioskPin", label: "Staff without a clocking-in PIN", href: "/staff?filter=needs-setup"');
    expect(dashboard).toContain('staffMissingPayArrangement", label: "Staff without current pay details", href: "/staff?filter=needs-setup"');
  });

  it("uses Staff records as the operational staff directory", () => {
    const staffPage = source("src/app/staff/page.tsx");
    const directory = source("src/components/staff/production-staff-screen.tsx");
    const addForm = sourceOrEmpty("src/components/staff/add-staff-form.tsx");
    const payPage = source("src/app/payroll/arrangements/page.tsx");
    const payScreen = sourceOrEmpty("src/components/payroll/pay-arrangements-screen.tsx");

    expect(staffPage).toContain("Staff records");
    expect(staffPage).toContain("<AddStaffForm");
    expect(staffPage).toContain('action === "add"');
    expect(staffPage).toContain("parseStaffDirectoryFilter(filter)");
    expect(directory).toContain("Needs setup");
    expect(directory).toContain("Open record");
    expect(directory).not.toContain("payArrangements");
    expect(directory).not.toContain("hourlyRate");
    expect(directory).not.toContain("annualSalary");
    expect(addForm).toContain("Full legal name");
    expect(addForm).toContain("Name shown on Staff Clock");
    expect(addForm).toContain("createStaffProfileAction");
    expect(payPage).toContain("<PayArrangementsScreen");
    expect(payScreen).toContain("savePayArrangementAction");
    expect(payScreen).toContain("closePayArrangementAction");
  });
});
