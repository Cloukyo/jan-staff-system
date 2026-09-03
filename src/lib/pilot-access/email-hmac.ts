import { createHmac } from "node:crypto";

export function normalisePilotEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function createPilotEmailHmac(email: string, secret: string): string {
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("COMMERCIAL_PILOT_ACCESS_HMAC_SECRET must be at least 32 bytes.");
  }
  return createHmac("sha256", secret)
    .update(normalisePilotEmail(email), "utf8")
    .digest("hex");
}
