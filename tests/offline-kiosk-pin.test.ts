import { describe, expect, it } from "vitest";
import {
  OFFLINE_PIN_PBKDF2_ITERATIONS,
  createDeviceKeys,
  createOfflinePinLockout,
  enrolOfflinePin,
  importSigningPublicKey,
  signOfflinePayload,
  verifyOfflinePayload,
  verifyOfflinePin,
} from "@/lib/kiosk/offline/crypto";

describe("device-specific offline PIN verification", () => {
  it("uses non-extractable private device keys", async () => {
    const keys = await createDeviceKeys();

    expect(keys.signingPrivateKey.extractable).toBe(false);
    expect(keys.verifierKey.extractable).toBe(false);
    expect(keys.signingPublicJwk.kty).toBe("EC");
    expect(keys.signingPublicJwk.crv).toBe("P-256");
  });

  it("uses the benchmarked PBKDF2-SHA-256 work factor", () => {
    expect(OFFLINE_PIN_PBKDF2_ITERATIONS).toBe(600_000);
  });

  it("accepts the enrolled six-digit PIN and rejects another", async () => {
    const { verifierKey } = await createDeviceKeys();
    const envelope = await enrolOfflinePin({
      pin: "482731",
      staffId: "staff-a",
      authorisationId: "authorisation-1",
      expiresAt: "2026-07-31T09:00:00Z",
      verifierKey,
    });
    const lockout = await createOfflinePinLockout({
      staffId: "staff-a",
      authorisationId: "authorisation-1",
      verifierKey,
      updatedAt: "2026-07-30T09:00:00Z",
    });

    await expect(
      verifyOfflinePin({
        pin: "482731",
        envelope,
        verifierKey,
        lockout,
        now: "2026-07-30T09:01:00Z",
      }),
    ).resolves.toEqual(expect.objectContaining({ status: "verified" }));
    await expect(
      verifyOfflinePin({
        pin: "482732",
        envelope,
        verifierKey,
        lockout,
        now: "2026-07-30T09:01:00Z",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: "invalid",
        lockout: expect.objectContaining({ failureCount: 1 }),
      }),
    );
  });

  it.each(["1234", "12345"])(
    "rejects %s for offline enrolment",
    async (pin) => {
      const { verifierKey } = await createDeviceKeys();

      await expect(
        enrolOfflinePin({
          pin,
          staffId: "staff-a",
          authorisationId: "authorisation-1",
          expiresAt: "2026-07-31T09:00:00Z",
          verifierKey,
        }),
      ).rejects.toThrow(/six-digit/i);
    },
  );

  it("stores no plaintext PIN or production bcrypt hash", async () => {
    const { verifierKey } = await createDeviceKeys();
    const envelope = await enrolOfflinePin({
      pin: "482731",
      staffId: "staff-a",
      authorisationId: "authorisation-1",
      expiresAt: "2026-07-31T09:00:00Z",
      verifierKey,
    });
    const serialised = JSON.stringify(envelope);

    expect(serialised).not.toContain("482731");
    expect(serialised).not.toMatch(/bcrypt|pin_hash/i);
  });

  it("scopes the verifier to staff and authorisation", async () => {
    const { verifierKey } = await createDeviceKeys();
    const envelope = await enrolOfflinePin({
      pin: "482731",
      staffId: "staff-a",
      authorisationId: "authorisation-1",
      expiresAt: "2026-07-31T09:00:00Z",
      verifierKey,
    });
    const changedEnvelope = {
      ...envelope,
      authorisationId: "authorisation-2",
    };
    const changedLockout = await createOfflinePinLockout({
      staffId: "staff-a",
      authorisationId: "authorisation-2",
      verifierKey,
      updatedAt: "2026-07-30T09:00:00Z",
    });

    await expect(
      verifyOfflinePin({
        pin: "482731",
        envelope: changedEnvelope,
        verifierKey,
        lockout: changedLockout,
        now: "2026-07-30T09:01:00Z",
      }),
    ).resolves.toEqual(expect.objectContaining({ status: "tampered" }));
  });

  it("rejects expiry before attempting verifier derivation", async () => {
    const { verifierKey } = await createDeviceKeys();
    const envelope = await enrolOfflinePin({
      pin: "482731",
      staffId: "staff-a",
      authorisationId: "authorisation-1",
      expiresAt: "2026-07-30T08:59:59Z",
      verifierKey,
    });
    const lockout = await createOfflinePinLockout({
      staffId: "staff-a",
      authorisationId: "authorisation-1",
      verifierKey,
      updatedAt: "2026-07-30T09:00:00Z",
    });

    await expect(
      verifyOfflinePin({
        pin: "482731",
        envelope,
        verifierKey,
        lockout,
        now: "2026-07-30T09:00:00Z",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: "expired",
      }),
    );
  });

  it("persists three failures and locks the fourth attempt before comparison", async () => {
    const { verifierKey } = await createDeviceKeys();
    const envelope = await enrolOfflinePin({
      pin: "482731",
      staffId: "staff-a",
      authorisationId: "authorisation-1",
      expiresAt: "2026-07-31T09:00:00Z",
      verifierKey,
    });
    let lockout = await createOfflinePinLockout({
      staffId: "staff-a",
      authorisationId: "authorisation-1",
      verifierKey,
      updatedAt: "2026-07-30T09:00:00Z",
    });

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const result = await verifyOfflinePin({
        pin: "000000",
        envelope,
        verifierKey,
        lockout,
        now: `2026-07-30T09:0${attempt}:00Z`,
      });
      expect(result.status).toBe("invalid");
      expect(result.lockout.failureCount).toBe(attempt);
      lockout = result.lockout;
    }

    const fourth = await verifyOfflinePin({
      pin: "482731",
      envelope,
      verifierKey,
      lockout,
      now: "2026-07-30T09:04:00Z",
    });
    expect(fourth.status).toBe("locked");
    expect(fourth.lockout.failureCount).toBe(3);
  });

  it("detects editing of an authenticated lockout record", async () => {
    const { verifierKey } = await createDeviceKeys();
    const envelope = await enrolOfflinePin({
      pin: "482731",
      staffId: "staff-a",
      authorisationId: "authorisation-1",
      expiresAt: "2026-07-31T09:00:00Z",
      verifierKey,
    });
    const lockout = await createOfflinePinLockout({
      staffId: "staff-a",
      authorisationId: "authorisation-1",
      verifierKey,
      updatedAt: "2026-07-30T09:00:00Z",
    });

    await expect(
      verifyOfflinePin({
        pin: "482731",
        envelope,
        verifierKey,
        lockout: { ...lockout, failureCount: 2 },
        now: "2026-07-30T09:01:00Z",
      }),
    ).resolves.toEqual(expect.objectContaining({ status: "tampered" }));
  });

  it("detects editing of verifier expiry or iteration metadata", async () => {
    const { verifierKey } = await createDeviceKeys();
    const envelope = await enrolOfflinePin({
      pin: "482731",
      staffId: "staff-a",
      authorisationId: "authorisation-1",
      expiresAt: "2026-07-31T09:00:00Z",
      verifierKey,
    });
    const lockout = await createOfflinePinLockout({
      staffId: "staff-a",
      authorisationId: "authorisation-1",
      verifierKey,
      updatedAt: "2026-07-30T09:00:00Z",
    });

    for (const changed of [
      { ...envelope, expiresAt: "2026-08-30T09:00:00Z" },
      { ...envelope, iterations: 1 },
      { ...envelope, authenticator: "not-valid-base64!" },
    ]) {
      await expect(
        verifyOfflinePin({
          pin: "482731",
          envelope: changed,
          verifierKey,
          lockout,
          now: "2026-07-30T09:01:00Z",
        }),
      ).resolves.toEqual(expect.objectContaining({ status: "tampered" }));
    }
  });
});

describe("signed offline action payloads", () => {
  it("verifies the canonical payload and rejects every identity change", async () => {
    const { signingPrivateKey, signingPublicJwk } = await createDeviceKeys();
    const publicKey = await importSigningPublicKey(signingPublicJwk);
    const payload = {
      deviceId: "device-1",
      staffId: "staff-a",
      action: "clock_in",
      idempotencyKey: "0b34bc9a-4c18-4cc2-85a8-92fe15c71ec7",
      deviceSequence: 1,
      occurredAtDevice: "2026-07-30T09:00:00Z",
    };
    const signature = await signOfflinePayload(payload, signingPrivateKey);

    await expect(
      verifyOfflinePayload(payload, signature, publicKey),
    ).resolves.toBe(true);

    for (const changed of [
      { ...payload, deviceId: "device-2" },
      { ...payload, staffId: "staff-b" },
      { ...payload, action: "clock_out" },
      { ...payload, idempotencyKey: crypto.randomUUID() },
      { ...payload, deviceSequence: 2 },
      { ...payload, occurredAtDevice: "2026-07-30T09:01:00Z" },
    ]) {
      await expect(
        verifyOfflinePayload(changed, signature, publicKey),
      ).resolves.toBe(false);
    }
  });
});
