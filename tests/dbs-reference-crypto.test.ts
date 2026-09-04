import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptDbsReference, encryptDbsReference } from "@/lib/compliance/dbs-reference-crypto-core";

describe("DBS reference protection", () => {
  const previousKey = process.env.DBS_REFERENCE_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.DBS_REFERENCE_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });

  afterEach(() => {
    if (previousKey === undefined) delete process.env.DBS_REFERENCE_ENCRYPTION_KEY;
    else process.env.DBS_REFERENCE_ENCRYPTION_KEY = previousKey;
  });

  it("encrypts a full reference without retaining plaintext and decrypts it server-side", () => {
    const encrypted = encryptDbsReference("001122334455");
    expect(encrypted).not.toContain("001122334455");
    expect(decryptDbsReference(encrypted)).toBe("001122334455");
  });

  it("rejects an invalid reference before encryption", () => {
    expect(() => encryptDbsReference("1234")).toThrow("12-digit");
  });

  it("fails closed when the server encryption key is unavailable", () => {
    delete process.env.DBS_REFERENCE_ENCRYPTION_KEY;
    expect(() => encryptDbsReference("001122334455")).toThrow("not configured");
  });
});
