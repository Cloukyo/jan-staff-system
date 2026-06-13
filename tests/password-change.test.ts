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
    expect(signIn).toContain('account.role === "manager" ? "/dashboard" : "/my-rota"');
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

  it("keeps private setup tooling ignored and password input hidden", () => {
    const gitignore = readFileSync(resolve(".gitignore"), "utf8");
    const screen = readFileSync(resolve("src/components/auth/change-password-screen.tsx"), "utf8");
    expect(gitignore).toContain("private-imports/");
    expect(screen).toContain('type="password"');
    expect(screen).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("routes password recovery through a server-side code exchange", () => {
    const actions = readFileSync(resolve("src/lib/auth/actions.ts"), "utf8");
    const callback = readFileSync(resolve("src/app/auth/callback/route.ts"), "utf8");
    const resetPage = readFileSync(resolve("src/app/reset-password/page.tsx"), "utf8");
    const resetScreen = readFileSync(resolve("src/components/auth/reset-password-screen.tsx"), "utf8");

    expect(actions).toContain("/auth/callback?next=/reset-password");
    expect(actions).toContain("resetRecoveredPasswordAction");
    expect(actions).toContain("await supabase.auth.signOut()");
    expect(callback).toContain("exchangeCodeForSession(code)");
    expect(callback).toContain('url.searchParams.get("next") === "/reset-password"');
    expect(resetPage).toContain("getCurrentAccount()");
    expect(resetScreen).toContain('type="password"');
    expect(resetScreen).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("explains Supabase reset email rate limits without logging private details", () => {
    const actions = readFileSync(resolve("src/lib/auth/actions.ts"), "utf8");
    expect(actions).toContain("error.status === 429");
    expect(actions).toContain("use only the newest link");
    expect(actions).not.toContain('console.error("Supabase password reset failed", { email');
  });
});
