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
});
