import { OFFLINE_PIN_MAX_FAILURES } from "@/lib/kiosk/offline/types";
import type {
  OfflinePinLockout,
  OfflinePinVerificationResult,
  OfflinePinVerifierEnvelope,
} from "@/lib/kiosk/offline/types";

export const OFFLINE_PIN_PBKDF2_ITERATIONS = 600_000;

const encoder = new TextEncoder();

function webCrypto(): Crypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto is required for offline Staff Clock security");
  }
  return globalThis.crypto;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function concatenate(...values: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    values.reduce((length, value) => length + value.length, 0),
  );
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.length;
  }
  return result;
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function scopeBytes(staffId: string, authorisationId: string): Uint8Array {
  return encoder.encode(`${staffId}\u0000${authorisationId}\u0000`);
}

function validTimestamp(value: string, label: string): number {
  const parsed = new Date(value).getTime();
  if (Number.isNaN(parsed)) {
    throw new RangeError(`${label} must be a valid timestamp`);
  }
  return parsed;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

async function deriveVerifier(input: {
  pin: string;
  staffId: string;
  authorisationId: string;
  salt: Uint8Array;
  iterations: number;
  verifierKey: CryptoKey;
}): Promise<Uint8Array> {
  const crypto = webCrypto();
  const pinBytes = encoder.encode(input.pin);
  const scope = scopeBytes(input.staffId, input.authorisationId);
  const scopedSalt = concatenate(input.salt, scope);
  const pinKey = await crypto.subtle.importKey(
    "raw",
    arrayBuffer(pinBytes),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derived = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: arrayBuffer(scopedSalt),
        iterations: input.iterations,
      },
      pinKey,
      256,
    ),
  );
  const verifier = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      input.verifierKey,
      arrayBuffer(concatenate(derived, scope)),
    ),
  );

  pinBytes.fill(0);
  derived.fill(0);
  return verifier;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalValue(entry)]),
    );
  }
  return value;
}

function canonicalBytes(payload: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(canonicalValue(payload)));
}

function lockoutPayload(
  lockout: Omit<OfflinePinLockout, "authenticator">,
): Uint8Array {
  return canonicalBytes(lockout);
}

function envelopePayload(
  envelope: Omit<OfflinePinVerifierEnvelope, "authenticator">,
): Uint8Array {
  return canonicalBytes(envelope);
}

async function authenticateLockout(
  lockout: Omit<OfflinePinLockout, "authenticator">,
  verifierKey: CryptoKey,
): Promise<string> {
  return bytesToBase64(
    new Uint8Array(
      await webCrypto().subtle.sign(
        "HMAC",
        verifierKey,
        arrayBuffer(lockoutPayload(lockout)),
      ),
    ),
  );
}

async function signedLockout(
  lockout: Omit<OfflinePinLockout, "authenticator">,
  verifierKey: CryptoKey,
): Promise<OfflinePinLockout> {
  return {
    ...lockout,
    authenticator: await authenticateLockout(lockout, verifierKey),
  };
}

async function authenticateEnvelope(
  envelope: Omit<OfflinePinVerifierEnvelope, "authenticator">,
  verifierKey: CryptoKey,
): Promise<string> {
  return bytesToBase64(
    new Uint8Array(
      await webCrypto().subtle.sign(
        "HMAC",
        verifierKey,
        arrayBuffer(envelopePayload(envelope)),
      ),
    ),
  );
}

export async function createDeviceKeys(): Promise<{
  signingPrivateKey: CryptoKey;
  signingPublicJwk: JsonWebKey;
  verifierKey: CryptoKey;
}> {
  const crypto = webCrypto();
  const signingKeys = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const verifierKey = await crypto.subtle.generateKey(
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"],
  );

  return {
    signingPrivateKey: signingKeys.privateKey,
    signingPublicJwk: await crypto.subtle.exportKey(
      "jwk",
      signingKeys.publicKey,
    ),
    verifierKey,
  };
}

export async function enrolOfflinePin(input: {
  pin: string;
  staffId: string;
  authorisationId: string;
  expiresAt: string;
  verifierKey: CryptoKey;
}): Promise<OfflinePinVerifierEnvelope> {
  if (!/^\d{6}$/.test(input.pin)) {
    throw new TypeError("Offline enrolment requires a six-digit PIN");
  }
  if (!input.staffId || !input.authorisationId) {
    throw new TypeError("Offline enrolment requires staff and authorisation");
  }
  validTimestamp(input.expiresAt, "Offline authorisation expiry");

  const salt = webCrypto().getRandomValues(new Uint8Array(16));
  const verifier = await deriveVerifier({
    pin: input.pin,
    staffId: input.staffId,
    authorisationId: input.authorisationId,
    salt,
    iterations: OFFLINE_PIN_PBKDF2_ITERATIONS,
    verifierKey: input.verifierKey,
  });

  const envelope: Omit<OfflinePinVerifierEnvelope, "authenticator"> = {
    schemaVersion: 1,
    staffId: input.staffId,
    authorisationId: input.authorisationId,
    salt: bytesToBase64(salt),
    iterations: OFFLINE_PIN_PBKDF2_ITERATIONS,
    verifier: bytesToBase64(verifier),
    expiresAt: input.expiresAt,
  };
  return {
    ...envelope,
    authenticator: await authenticateEnvelope(envelope, input.verifierKey),
  };
}

export async function createOfflinePinLockout(input: {
  staffId: string;
  authorisationId: string;
  verifierKey: CryptoKey;
  updatedAt: string;
}): Promise<OfflinePinLockout> {
  validTimestamp(input.updatedAt, "Offline lockout update time");
  return signedLockout(
    {
      schemaVersion: 1,
      staffId: input.staffId,
      authorisationId: input.authorisationId,
      failureCount: 0,
      locked: false,
      updatedAt: input.updatedAt,
    },
    input.verifierKey,
  );
}

async function lockoutIsAuthentic(
  lockout: OfflinePinLockout,
  verifierKey: CryptoKey,
): Promise<boolean> {
  const { authenticator, ...payload } = lockout;
  try {
    const expected = await authenticateLockout(payload, verifierKey);
    return constantTimeEqual(
      base64ToBytes(authenticator),
      base64ToBytes(expected),
    );
  } catch {
    return false;
  }
}

async function envelopeIsAuthentic(
  envelope: OfflinePinVerifierEnvelope,
  verifierKey: CryptoKey,
): Promise<boolean> {
  try {
    const { authenticator, ...payload } = envelope;
    const expected = await authenticateEnvelope(payload, verifierKey);
    return constantTimeEqual(
      base64ToBytes(authenticator),
      base64ToBytes(expected),
    );
  } catch {
    return false;
  }
}

export async function verifyOfflinePin(input: {
  pin: string;
  envelope: OfflinePinVerifierEnvelope;
  verifierKey: CryptoKey;
  lockout: OfflinePinLockout;
  now: string;
}): Promise<OfflinePinVerificationResult> {
  const now = validTimestamp(input.now, "Offline verification time");
  if (!(await envelopeIsAuthentic(input.envelope, input.verifierKey))) {
    return { status: "tampered", lockout: input.lockout };
  }
  if (now >= validTimestamp(input.envelope.expiresAt, "Offline expiry")) {
    return { status: "expired", lockout: input.lockout };
  }

  if (
    input.lockout.staffId !== input.envelope.staffId ||
    input.lockout.authorisationId !== input.envelope.authorisationId ||
    !(await lockoutIsAuthentic(input.lockout, input.verifierKey))
  ) {
    return { status: "tampered", lockout: input.lockout };
  }

  if (
    input.lockout.locked ||
    input.lockout.failureCount >= OFFLINE_PIN_MAX_FAILURES
  ) {
    const lockout = await signedLockout(
      {
        ...input.lockout,
        locked: true,
        updatedAt: input.now,
      },
      input.verifierKey,
    );
    return { status: "locked", lockout };
  }

  const actual = await deriveVerifier({
    pin: input.pin,
    staffId: input.envelope.staffId,
    authorisationId: input.envelope.authorisationId,
    salt: base64ToBytes(input.envelope.salt),
    iterations: input.envelope.iterations,
    verifierKey: input.verifierKey,
  });
  const matches = constantTimeEqual(
    actual,
    base64ToBytes(input.envelope.verifier),
  );

  if (matches) {
    return {
      status: "verified",
      lockout: await signedLockout(
        {
          schemaVersion: 1,
          staffId: input.envelope.staffId,
          authorisationId: input.envelope.authorisationId,
          failureCount: 0,
          locked: false,
          updatedAt: input.now,
        },
        input.verifierKey,
      ),
    };
  }

  return {
    status: "invalid",
    lockout: await signedLockout(
      {
        schemaVersion: 1,
        staffId: input.envelope.staffId,
        authorisationId: input.envelope.authorisationId,
        failureCount: input.lockout.failureCount + 1,
        locked: false,
        updatedAt: input.now,
      },
      input.verifierKey,
    ),
  };
}

export async function signOfflinePayload(
  payload: unknown,
  privateKey: CryptoKey,
): Promise<string> {
  return bytesToBase64(
    new Uint8Array(
      await webCrypto().subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        privateKey,
        arrayBuffer(canonicalBytes(payload)),
      ),
    ),
  );
}

export async function importSigningPublicKey(
  publicJwk: JsonWebKey,
): Promise<CryptoKey> {
  return webCrypto().subtle.importKey(
    "jwk",
    publicJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
}

export async function verifyOfflinePayload(
  payload: unknown,
  signature: string,
  publicKey: CryptoKey,
): Promise<boolean> {
  return webCrypto().subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    arrayBuffer(base64ToBytes(signature)),
    arrayBuffer(canonicalBytes(payload)),
  );
}
