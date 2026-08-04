export {
  cleanupOfflineData,
  enqueueAttendanceAction,
  listPendingActions,
  persistSyncReceipt,
} from "@/lib/kiosk/offline/database";

import {
  reserveOfflineDeviceSequence,
  storePreparedPendingAction,
} from "@/lib/kiosk/offline/database";
import { signOfflinePayload } from "@/lib/kiosk/offline/crypto";
import {
  offlineSyncRequestSchema,
  payloadForOfflineSignature,
} from "@/lib/kiosk/offline/server-contract";
import type {
  PendingAttendanceAction,
  UnsignedPendingAction,
} from "@/lib/kiosk/offline/types";

export async function enqueueSignedAttendanceAction(input: {
  evidence: Omit<UnsignedPendingAction, "signature">;
  signingPrivateKey: CryptoKey;
  now?: () => string;
}): Promise<PendingAttendanceAction> {
  const deviceSequence = await reserveOfflineDeviceSequence();
  const queueCreatedAt = (input.now ?? (() => new Date().toISOString()))();
  const request = offlineSyncRequestSchema.parse({
    ...input.evidence,
    schemaVersion: 1,
    deviceSequence,
    queueCreatedAt,
    clockConfidence: input.evidence.clockConfidence ?? "uncertain",
    elapsedSinceAuthorisationMs:
      input.evidence.elapsedSinceAuthorisationMs ?? null,
    signature: "cGxhY2Vob2xkZXI=",
  });
  const signature = await signOfflinePayload(
    payloadForOfflineSignature(request),
    input.signingPrivateKey,
  );
  const action: PendingAttendanceAction = {
    ...input.evidence,
    schemaVersion: 1,
    deviceSequence,
    queueCreatedAt,
    clockConfidence: request.clockConfidence,
    elapsedSinceAuthorisationMs: request.elapsedSinceAuthorisationMs,
    signature,
    status: "pending",
    retryCount: 0,
    lastErrorCategory: null,
  };
  await storePreparedPendingAction(action);
  return action;
}
