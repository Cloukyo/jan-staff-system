import { cookies } from "next/headers";
import { decodeCommercialPreference, encodeCommercialPreference, type CommercialPreference } from "./preference";
import { COMMERCIAL_PREFERENCE_COOKIE, commercialPreferenceCookieOptions, getCommercialSessionSecret } from "./cookie";
export { COMMERCIAL_PREFERENCE_COOKIE, commercialPreferenceCookieOptions, getCommercialSessionSecret } from "./cookie";

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
