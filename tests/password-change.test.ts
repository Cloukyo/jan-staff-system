import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validatePrivatePassword } from "@/lib/auth/password-validation";

describe("forced password change", () => {
  it("requires a strong private password", () => {
    expect(validatePrivatePassword("short", "nazmon@example.com")).toBeTruthy();
    expect(validatePrivatePassword("NazmonSecure1!", "nazmon@example.com")).toMatch(/email/i);
    expect(validatePrivatePassword("Private-Access-4827", "nazmon@example.com")).toBeNull();
  });

  it("redirects required accounts before manager screens", () => {
    const middleware = readFileSync(resolve("middleware.ts"), "utf8");
    const permissions = readFileSync(resolve("src/lib/auth/permissions.ts"), "utf8");
    const signIn = readFileSync(resolve("src/lib/auth/actions.ts"), "utf8");
    expect(middleware).toContain('url.pathname = "/change-password"');
    expect(permissions).toContain('redirect("/change-password")');
    expect(signIn).toContain('account.must_change_password ? "/change-password" : "/dashboard"');
  });

  it("updates through the authenticated Supabase session and clears only the current account flag", () => {
    const actions = readFileSync(resolve("src/lib/auth/actions.ts"), "utf8");
    const migration = readFileSync(resolve("supabase/migrations/202606120007_forced_password_change.sql"), "utf8");
    expect(actions).toContain("supabase.auth.updateUser({ password })");
    expect(actions).toContain('supabase.rpc("complete_required_password_change")');
    expect(migration).toContain("where auth_user_id = auth.uid()");
    expect(migration).toContain("must_change_password = false");
    expect(migration).toContain("revoke all on function public.complete_required_password_change()");
  });

  it("keeps the one-time Admin API helper ignored and password input hidden", () => {
    const gitignore = readFileSync(resolve(".gitignore"), "utf8");
    expect(gitignore).toContain("private-imports/");
    const helper = readFileSync(resolve("private-imports/set-nazmon-temporary-password.ps1"), "utf8");
    expect(helper).toContain('Read-Host "Temporary password" -AsSecureString');
    expect(helper).toContain("/auth/v1/admin/users/");
    expect(helper).not.toMatch(/password\s*=\s*["'][^"']+["']/i);
  });
});
