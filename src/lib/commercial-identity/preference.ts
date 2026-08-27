export type CommercialPreference = {
  membershipId: string;
  siteId: string | null;
  authorisationRevision: number;
};

type SignedPayload = CommercialPreference & { issuedAt: number; expiresAt: number };

const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function sign(content: string, secret: string): Promise<Uint8Array> {
  if (secret.length < 32) throw new Error("COMMERCIAL_SESSION_SECRET must contain at least 32 characters.");
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(content)));
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export async function encodeCommercialPreference(
  preference: CommercialPreference,
  secret: string,
  now = new Date(),
  maxAgeSeconds = 60 * 60 * 24 * 30,
): Promise<string> {
  const payload: SignedPayload = {
    ...preference,
    issuedAt: Math.floor(now.getTime() / 1000),
    expiresAt: Math.floor(now.getTime() / 1000) + maxAgeSeconds,
  };
  const body = base64Url(encoder.encode(JSON.stringify(payload)));
  return `v1.${body}.${base64Url(await sign(`v1.${body}`, secret))}`;
}

export async function decodeCommercialPreference(
  encoded: string | null | undefined,
  secret: string,
  now = new Date(),
): Promise<CommercialPreference | null> {
  try {
    const [version, body, signature, extra] = encoded?.split(".") ?? [];
    if (version !== "v1" || !body || !signature || extra) return null;
    if (!equalBytes(fromBase64Url(signature), await sign(`${version}.${body}`, secret))) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as SignedPayload;
    const nowSeconds = Math.floor(now.getTime() / 1000);
    if (!payload.membershipId || !Number.isInteger(payload.authorisationRevision) || payload.authorisationRevision < 1) return null;
    if (!Number.isFinite(payload.issuedAt) || !Number.isFinite(payload.expiresAt) || payload.issuedAt > nowSeconds + 60 || payload.expiresAt <= nowSeconds) return null;
    if (payload.siteId !== null && typeof payload.siteId !== "string") return null;
    return { membershipId: payload.membershipId, siteId: payload.siteId, authorisationRevision: payload.authorisationRevision };
  } catch {
    return null;
  }
}

const continuationPaths = new Set([
  "/dashboard", "/attendance", "/rota", "/staff", "/my-attendance", "/my-rota", "/organisations/select", "/mfa",
  "/payroll", "/payroll/arrangements", "/payroll/review",
]);

export function safeCommercialContinuation(candidate: string | null | undefined): string {
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\") || /[\u0000-\u001f]/.test(candidate)) return "/dashboard";
  const path = candidate.split("?", 1)[0];
  return continuationPaths.has(path) ? candidate : "/dashboard";
}
