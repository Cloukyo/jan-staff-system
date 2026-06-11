import { describe, expect, it } from "vitest";
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
});
