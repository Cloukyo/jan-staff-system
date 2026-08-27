import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { browserIdentifiers } from "@/lib/platform/browser-identifiers";

export const KIOSK_DEVICE_COOKIE = browserIdentifiers.deviceCookie.current;
export const LEGACY_KIOSK_DEVICE_COOKIES = browserIdentifiers.deviceCookie.legacy;
const MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

export function createKioskDeviceToken() {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: createHash("sha256").update(token).digest("hex"),
    expiresAt: new Date(Date.now() + MAX_AGE_SECONDS * 1000),
  };
}

export async function getKioskDeviceToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(KIOSK_DEVICE_COOKIE)?.value
    ?? LEGACY_KIOSK_DEVICE_COOKIES.map((name) => store.get(name)?.value).find(Boolean)
    ?? null;
}

export async function setKioskDeviceCookie(token: string, expires: Date) {
  (await cookies()).set(KIOSK_DEVICE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires,
  });
}

export async function clearKioskDeviceCookie() {
  const store = await cookies();
  for (const name of [KIOSK_DEVICE_COOKIE, ...LEGACY_KIOSK_DEVICE_COOKIES]) store.set(name, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}
