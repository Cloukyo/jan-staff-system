import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(path), "utf8");
}

describe("plain manager wording", () => {
  it("removes production provider badges from ordinary manager screens", () => {
    for (const path of [
      "src/app/attendance/page.tsx",
      "src/app/settings/kiosk/page.tsx",
      "src/components/compliance/production-compliance-detail.tsx",
      "src/components/compliance/production-compliance-screen.tsx",
      "src/components/leave/production-leave.tsx",
      "src/components/accounts/production-accounts.tsx",
      "src/components/rota/template-manager.tsx",
    ]) {
      expect(source(path)).not.toMatch(/Production data[^<"]*Supabase/);
    }
  });

  it("uses staff login language on ordinary account controls", () => {
    const accounts = source("src/components/accounts/production-accounts.tsx");

    expect(accounts).toContain("Staff login access");
    expect(accounts).toContain("Send login invitation");
    expect(accounts).not.toMatch(
      />Accounts<|canonical staff profile|Send Supabase invitation|Creates one Auth user/,
    );
  });

  it("uses import and review language instead of database terminology", () => {
    const review = source("src/components/payroll/payroll-review-screen.tsx");

    expect(review).not.toMatch(
      /Supabase tables|private review batch|>Review batches<|payroll review batch|locks the batch|Final production import|effective-dated pay arrangements|Canonical staff profile/,
    );
    expect(review).toContain("Import review");
    expect(review).toContain("Staff record");
  });

  it("calls public device setup Clocking-in devices", () => {
    const clock = source("src/app/clock/page.tsx");

    expect(clock).toContain("Clocking-in devices");
    expect(clock).not.toContain("Kiosk Setup");
  });

  it("keeps the ordinary login and reset flow provider-neutral", () => {
    const login = source("src/components/app/login-screen.tsx");
    const actions = source("src/lib/auth/actions.ts");

    expect(login).not.toContain("Supabase");
    expect(actions).not.toContain("Supabase will send a reset link");
  });
});
