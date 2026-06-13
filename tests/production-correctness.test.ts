import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(path), "utf8");
}

describe("production correctness routes", () => {
  it("branches leave routes away from the demo repository in production", () => {
    for (const route of ["src/app/leave/page.tsx", "src/app/leave/request/page.tsx", "src/app/leave/requests/page.tsx"]) {
      const page = source(route);
      expect(page).toContain('getAppMode() === "demo"');
      expect(page).toContain("Production");
    }
    expect(source("src/components/leave/production-leave.tsx")).not.toContain("useDemoRepository");
  });

  it("loads the profile from the authenticated account and canonical staff id", () => {
    const profile = source("src/lib/profile/server.ts");
    expect(profile).toContain('requireAccount(["manager", "staff"])');
    expect(profile).toContain("account.staffId");
    expect(profile).not.toContain("useDemoRepository");
  });

  it("keeps Supabase administration server-only", () => {
    const admin = source("src/lib/auth/supabase-admin.ts");
    const accounts = source("src/lib/accounts/server.ts");
    expect(admin).toContain('import "server-only"');
    expect(admin).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(admin).not.toContain("NEXT_PUBLIC_SUPABASE_SERVICE");
    expect(accounts).toContain("inviteUserByEmail");
    expect(accounts).toContain("getUserById");
  });

  it("does not expose prototype settings in production", () => {
    const page = source("src/app/settings/page.tsx");
    const production = source("src/components/settings/production-settings.tsx");
    expect(page).toContain('getAppMode() === "demo"');
    expect(production).not.toContain("Demo today");
    expect(production).not.toContain("reseed");
    expect(production).not.toContain("localStorage");
  });

  it("records account access changes without storing credentials", () => {
    const migration = source("supabase/migrations/202606130005_production_account_access_audit.sql");
    expect(migration).toContain("staff_account_access_audit");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("performed_by");
    expect(migration).not.toContain("password");
    expect(migration).not.toContain("service_role");
  });
});
