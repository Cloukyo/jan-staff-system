import {
  getDeviceKeys,
  getOfflinePinLockout,
  getOfflinePinVerifier,
  getOfflineProvisioningPackage,
  getTrustedState,
  installOfflineProvisioningPackage,
  listPendingActions,
  putOfflinePinLockout,
  putOfflinePinVerifier,
  saveDeviceKeys,
} from "@/lib/kiosk/offline/database";
import {
  createDeviceKeys,
  createOfflinePinLockout,
  enrolOfflinePin,
  verifyOfflinePin,
} from "@/lib/kiosk/offline/crypto";
import { offlineProvisionDatabaseResponseSchema } from "@/lib/kiosk/offline/server-contract";
import { enqueueSignedAttendanceAction } from "@/lib/kiosk/offline/queue";
import { buildProvisionalState } from "@/lib/kiosk/offline/projection";
import { isoDateInLondon } from "@/lib/dates/format";
import type { AttendanceAction } from "@/lib/attendance/types";
import type { PendingAttendanceAction } from "@/lib/kiosk/offline/types";

export const OFFLINE_APP_VERSION = "0.1.0";

let activeClockAnchor: {
  authorisationId: string;
  elapsedAtReceiptMs: number;
  performanceAtReceipt: number;
} | null = null;
const queueFlights = new Map<string, Promise<PendingAttendanceAction>>();

async function deviceKeys() {
  const existing = await getDeviceKeys();
  if (existing) return existing;
  const created = await createDeviceKeys();
  await saveDeviceKeys(created);
  return created;
}

export async function refreshOfflineProvisioning(input: {
  fetcher?: typeof fetch;
  now?: () => string;
} = {}): Promise<
  | { status: "active"; package: NonNullable<Awaited<ReturnType<typeof getOfflineProvisioningPackage>>> }
  | { status: string }
> {
  const keys = await deviceKeys();
  let response: Response;
  try {
    response = await (input.fetcher ?? fetch)("/api/kiosk/offline/provision", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 1,
        appVersion: OFFLINE_APP_VERSION,
        deviceTime: (input.now ?? (() => new Date().toISOString()))(),
        signingPublicJwk: keys.signingPublicJwk,
      }),
    });
  } catch {
    return { status: "unavailable" };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { status: "unavailable" };
  }
  const parsed = offlineProvisionDatabaseResponseSchema.safeParse(body);
  if (!parsed.success) return { status: "unavailable" };
  if (!parsed.data.ok) return { status: parsed.data.code };
  await installOfflineProvisioningPackage(parsed.data.package);
  if (typeof performance !== "undefined") {
    activeClockAnchor = {
      authorisationId: parsed.data.package.authorisation.id,
      elapsedAtReceiptMs: Math.max(
        0,
        new Date((input.now ?? (() => new Date().toISOString()))()).getTime()
          - new Date(parsed.data.package.authorisation.issuedAt).getTime(),
      ),
      performanceAtReceipt: performance.now(),
    };
  }
  return { status: "active", package: parsed.data.package };
}

export function queueProvisionalAttendanceAction(input: {
  staffId: string;
  action: AttendanceAction;
  expectedRevision: string;
  occurredAt: string;
  unresolvedOlderException: boolean;
}): Promise<PendingAttendanceAction> {
  const flightKey = `${input.staffId}:${input.action}`;
  const existing = queueFlights.get(flightKey);
  if (existing) return existing;
  const flight = (async () => {
    const [packageValue, keys, trustedState, provisionalState, queued] = await Promise.all([
      getOfflineProvisioningPackage(),
      deviceKeys(),
      getTrustedState(input.staffId),
      buildProvisionalState(input.staffId),
      listPendingActions(),
    ]);
    if (!packageValue || !keys || !trustedState) {
      throw new Error("Offline Staff Clock is not provisioned");
    }
    if (new Date(input.occurredAt).getTime() >= new Date(packageValue.authorisation.expiresAt).getTime()) {
      throw new Error("Offline Staff Clock authorisation has expired");
    }
    if (provisionalState.revision !== input.expectedRevision
      || !provisionalState.allowedActions.includes(input.action)) {
      throw new Error("Offline attendance state changed before confirmation");
    }
    const previous = queued
      .filter((action) => action.staffId === input.staffId)
      .at(-1) ?? null;
    const anchored = activeClockAnchor?.authorisationId === packageValue.authorisation.id
      && typeof performance !== "undefined";
    const elapsed = anchored
      ? Math.max(0, Math.round(activeClockAnchor!.elapsedAtReceiptMs
        + performance.now() - activeClockAnchor!.performanceAtReceipt))
      : null;
    return enqueueSignedAttendanceAction({
      signingPrivateKey: keys.signingPrivateKey,
      evidence: {
        idempotencyKey: crypto.randomUUID(),
        authorisationId: packageValue.authorisation.id,
        rosterVersion: packageValue.authorisation.rosterVersion,
        deviceId: packageValue.device.id,
        staffId: input.staffId,
        action: input.action,
        occurredAtDevice: input.occurredAt,
        deviceTimezone: "Europe/London",
        operationalDateAtDevice: isoDateInLondon(new Date(input.occurredAt)),
        trustedSnapshotRevision: trustedState.state.revision,
        priorPendingActionId: previous?.idempotencyKey ?? null,
        unresolvedOlderException: input.unresolvedOlderException,
        clockConfidence: anchored ? "anchored" : "uncertain",
        elapsedSinceAuthorisationMs: elapsed,
      },
    });
  })().finally(() => queueFlights.delete(flightKey));
  queueFlights.set(flightKey, flight);
  return flight;
}

export async function enrolVerifiedOfflinePin(input: {
  staffId: string;
  pin: string;
  now: string;
}): Promise<{ status: "enrolled" | "ineligible" | "unavailable" }> {
  if (!/^\d{6}$/.test(input.pin)) return { status: "ineligible" };
  const packageValue = await getOfflineProvisioningPackage();
  if (!packageValue?.roster.some((entry) => entry.staffId === input.staffId)) {
    return { status: "unavailable" };
  }
  const keys = await deviceKeys();
  const envelope = await enrolOfflinePin({
    pin: input.pin,
    staffId: input.staffId,
    authorisationId: packageValue.authorisation.id,
    expiresAt: packageValue.authorisation.expiresAt,
    verifierKey: keys.verifierKey,
  });
  const lockout = await createOfflinePinLockout({
    staffId: input.staffId,
    authorisationId: packageValue.authorisation.id,
    verifierKey: keys.verifierKey,
    updatedAt: input.now,
  });
  await putOfflinePinVerifier(envelope);
  await putOfflinePinLockout(lockout);
  return { status: "enrolled" };
}

export async function verifyStoredOfflinePin(input: {
  staffId: string;
  pin: string;
  now: string;
}): Promise<
  | { status: "unavailable" }
  | { status: "verified" | "invalid" | "locked" | "expired" | "tampered" }
> {
  const packageValue = await getOfflineProvisioningPackage();
  const keys = await getDeviceKeys();
  if (!packageValue || !keys) return { status: "unavailable" };
  const [envelope, lockout] = await Promise.all([
    getOfflinePinVerifier(input.staffId, packageValue.authorisation.id),
    getOfflinePinLockout(input.staffId, packageValue.authorisation.id),
  ]);
  if (!envelope || !lockout) return { status: "unavailable" };
  const result = await verifyOfflinePin({
    pin: input.pin,
    envelope,
    verifierKey: keys.verifierKey,
    lockout,
    now: input.now,
  });
  await putOfflinePinLockout(result.lockout);
  return { status: result.status };
}
