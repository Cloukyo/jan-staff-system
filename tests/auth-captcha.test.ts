import { describe, expect, it } from "vitest";
import { captchaTokenForAuth } from "@/lib/auth/captcha";

describe("conditional Auth CAPTCHA", () => {
  it("does not require a token when Turnstile is not configured", () => {
    expect(captchaTokenForAuth(new FormData(), undefined)).toBeUndefined();
  });

  it("returns the configured Turnstile response", () => {
    const form = new FormData();
    form.set("cf-turnstile-response", " test-token ");
    expect(captchaTokenForAuth(form, "site-key")).toBe("test-token");
  });

  it("fails closed when Turnstile is configured but no response is supplied", () => {
    expect(() => captchaTokenForAuth(new FormData(), "site-key")).toThrow("Complete the security check");
  });
});
