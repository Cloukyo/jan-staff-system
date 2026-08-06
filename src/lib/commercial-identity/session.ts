import { cookies } from "next/headers";
import { decodeCommercialPreference, encodeCommercialPreference, type CommercialPreference } from "./preference";

export const COMMERCIAL_PREFERENCE_COOKIE = "commercial_membership";

export function getCommercialSessionSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.COMMERCIAL_SESSION_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error("COMMERCIAL_SESSION_SECRET must contain at least 32 characters before commercial organisation selection is used.");
  return secret;
}

export function commercialPreferenceCookieOptions(production: boolean) {
  return { httpOnly: true, secure: production, sameSite: "lax" as const, path: "/", maxAge: 60 * 60 * 24 * 30 };
}

export async function readCommercialPreference(): Promise<CommercialPreference | null> {
  const value = (await cookies()).get(COMMERCIAL_PREFERENCE_COOKIE)?.value;
  if (!value) return null;
  return decodeCommercialPreference(value, getCommercialSessionSecret());
}

export async function writeCommercialPreference(preference: CommercialPreference): Promise<void> {
  const store = await cookies();
  store.set(
    COMMERCIAL_PREFERENCE_COOKIE,
    await encodeCommercialPreference(preference, getCommercialSessionSecret()),
    commercialPreferenceCookieOptions(process.env.NODE_ENV === "production"),
  );
}

export async function clearCommercialPreference(): Promise<void> {
  (await cookies()).set(COMMERCIAL_PREFERENCE_COOKIE, "", {
    ...commercialPreferenceCookieOptions(process.env.NODE_ENV === "production"),
    maxAge: 0,
  });
}
