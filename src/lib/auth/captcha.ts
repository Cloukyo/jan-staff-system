export const CAPTCHA_REQUIRED_MESSAGE = "Complete the security check and try again.";

export class CaptchaRequiredError extends Error {
  constructor() {
    super(CAPTCHA_REQUIRED_MESSAGE);
    this.name = "CaptchaRequiredError";
  }
}

export function captchaTokenForAuth(formData: FormData, configuredSiteKey: string | undefined): string | undefined {
  if (!configuredSiteKey?.trim()) return undefined;
  const token = String(formData.get("cf-turnstile-response") ?? "").trim();
  if (!token) throw new CaptchaRequiredError();
  return token;
}

export function configuredCaptchaToken(formData: FormData): string | undefined {
  return captchaTokenForAuth(formData, process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
}
