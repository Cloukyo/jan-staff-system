import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";

export const KIOSK_DEVICE_COOKIE = "jan_kiosk_device";
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
  return (await cookies()).get(KIOSK_DEVICE_COOKIE)?.value ?? null;
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
  (await cookies()).set(KIOSK_DEVICE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}
