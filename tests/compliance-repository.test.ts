import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getAppMode } from "@/lib/app-mode";
import { complianceRepositorySource } from "@/lib/compliance/repository";

describe("compliance repository selection", () => {
  it("uses the safe demo default until production mode is explicit", () => {
    expect(getAppMode({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe("demo");
    expect(getAppMode({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe("demo");
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

  it("uses the commercial-first compatibility actor for Staff and Compliance routes", () => {
    const compliancePage = readFileSync(resolve("src/app/compliance/page.tsx"), "utf8");
    const staffPage = readFileSync(resolve("src/app/staff/page.tsx"), "utf8");
    const detailPage = readFileSync(resolve("src/app/compliance/staff/[staffId]/page.tsx"), "utf8");
    const complianceScreen = readFileSync(resolve("src/components/compliance/production-compliance-screen.tsx"), "utf8");
    expect(compliancePage).toContain('requireCustomerDomainActor("compliance.read", { siteRequired: true })');
    expect(compliancePage).toContain('redirect("/staff?filter=needs-checks")');
    expect(staffPage).toContain('requireCustomerDomainActor(adding ? "staff.manage" : "staff.read", { siteRequired: true })');
    expect(staffPage).toContain('requirePermission(actor.context, "compliance.read")');
    expect(staffPage).toContain("loadProductionStaffRows(commercialContext)");
    expect(detailPage).toContain('requireCustomerDomainActor("compliance.read", { siteRequired: true })');
    expect(detailPage).toContain("loadProductionStaffCompliance(staffId, commercialContext)");
    expect(detailPage).not.toContain('requireAccount(["manager"])');
    expect(complianceScreen).not.toContain("Add staff member");
    expect(complianceScreen).not.toContain("createStaffProfileAction");
  });

  it("scopes Staff and nested Compliance reads and writes to the selected commercial site", () => {
    const scope = readFileSync(resolve("src/lib/staff/commercial-scope.ts"), "utf8");
    const repository = readFileSync(resolve("src/lib/compliance/repository.ts"), "utf8");
    const actions = readFileSync(resolve("src/lib/compliance/actions.ts"), "utf8");
    expect(scope).toContain('.eq("organisation_id", context.organisationId)');
    expect(scope).toContain('.eq("site_id", selectedSiteId(context))');
    expect(scope).toContain('.eq("staff_id", staffId)');
    for (const table of ["staff_qualifications", "staff_certificates", "staff_reference_checks"]) {
      expect(repository).toContain(`${table}\").select`);
    }
    expect(repository).toContain('qualificationQuery.in("staff_id", scopedStaffIds!)');
    expect(repository).toContain('certificateQuery.in("staff_id", scopedStaffIds!)');
    expect(repository).toContain('referenceQuery.in("staff_id", scopedStaffIds!)');
    expect(actions).toContain("isCommercialStaffInSelectedSiteScope(actor.context, staffId)");
    expect(actions).toContain('.eq("organisation_id", actor.context.organisationId).eq("staff_id", staffId)');
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
