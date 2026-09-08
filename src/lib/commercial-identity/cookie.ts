// Shared by middleware and server actions, without importing next/headers into middleware.
export const COMMERCIAL_PREFERENCE_COOKIE = "commercial_membership";

export function getCommercialSessionSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.COMMERCIAL_SESSION_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error("COMMERCIAL_SESSION_SECRET must contain at least 32 characters before commercial organisation selection is used.");
  return secret;
}

export function commercialPreferenceCookieOptions(production: boolean) {
  return { httpOnly: true, secure: production, sameSite: "lax" as const, path: "/", maxAge: 60 * 60 * 24 * 30 };
}
