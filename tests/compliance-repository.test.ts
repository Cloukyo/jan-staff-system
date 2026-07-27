import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getAppMode } from "@/lib/app-mode";
import { complianceRepositorySource } from "@/lib/compliance/repository";

describe("compliance repository selection", () => {
  it("selects demo only when demo mode is explicit or development default", () => {
    expect(getAppMode({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe("demo");
    expect(getAppMode({ APP_MODE: "demo", NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe("demo");
    expect(complianceRepositorySource("demo", false)).toBe("demo");
  });

  it("selects Supabase for configured production mode", () => {
    expect(getAppMode({ APP_MODE: "production", NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe("production");
    expect(complianceRepositorySource("production", true)).toBe("supabase");
  });

  it("does not fall back to demo data when production configuration is missing", () => {
    expect(() => complianceRepositorySource("production", false)).toThrow("Production compliance mode requires");
  });

  it("keeps the legacy compliance URL as a manager-only staff setup redirect", () => {
    const compliancePage = readFileSync(resolve("src/app/compliance/page.tsx"), "utf8");
    const complianceScreen = readFileSync(resolve("src/components/compliance/production-compliance-screen.tsx"), "utf8");
    expect(compliancePage).toContain('requireAccount(["manager"])');
    expect(compliancePage).toContain('redirect("/staff?filter=needs-checks")');
    expect(complianceScreen).not.toContain("Add staff member");
    expect(complianceScreen).not.toContain("createStaffProfileAction");
  });

  it("refreshes every staff profile consumer after a successful profile save", () => {
    const actions = readFileSync(resolve("src/lib/compliance/actions.ts"), "utf8");
    const staffActions = readFileSync(resolve("src/lib/staff/actions.ts"), "utf8");
    const helperStart = actions.indexOf("function revalidateStaffProfileViews");
    const helper = actions.slice(helperStart, actions.indexOf("\n}", helperStart) + 2);

    expect(helperStart).toBeGreaterThan(-1);
    for (const path of ["/staff", "/compliance", "/clock", "/attendance", "/settings/kiosk"]) {
      expect(helper).toContain(`revalidatePath("${path}")`);
    }
    expect(helper).toContain("revalidatePath(`/compliance/staff/${staffId}`)");

    const quickUpdateStart = actions.indexOf("export async function quickUpdateStaffProfileAction");
    const updateStart = actions.indexOf("export async function updateStaffProfileAction");
    const updateEnd = actions.indexOf("export async function saveQualificationAction");
    const createStart = staffActions.indexOf("export async function createStaffProfileAction");
    const createEnd = staffActions.indexOf("export async function deactivateStaffProfileAction");
    const createAction = staffActions.slice(createStart, createEnd);
    const quickUpdateAction = actions.slice(quickUpdateStart, updateStart);
    const updateAction = actions.slice(updateStart, updateEnd);

    expect(createAction.indexOf("refreshStaffPaths(id)"))
      .toBeGreaterThan(createAction.indexOf('if (error) return fail("Staff profile could not be created.'));
    expect(quickUpdateAction.indexOf("revalidateStaffProfileViews(staffId)"))
      .toBeGreaterThan(quickUpdateAction.indexOf('if (error) return fail("Quick edit could not be saved.");'));
    expect(updateAction.indexOf("revalidateStaffProfileViews(staffId)"))
      .toBeGreaterThan(updateAction.indexOf('if (error) return fail("Staff profile could not be saved.");'));
  });
});
