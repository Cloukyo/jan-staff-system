import {
  OFFLINE_DEFINITIVE_QUEUE_RETENTION_DAYS,
  type DeviceSecurityKeys,
  type OfflinePinLockout,
  type OfflinePinVerifierEnvelope,
  type OfflineRosterSnapshot,
  type OfflineSyncReceipt,
  type PendingAttendanceAction,
  type SyncReceiptTransaction,
  type TrustedAttendanceState,
  type UnsignedPendingAction,
} from "@/lib/kiosk/offline/types";
import type { OfflineProvisioningPackage } from "@/lib/kiosk/offline/server-contract";
import { browserIdentifiers } from "@/lib/platform/browser-identifiers";

export const OFFLINE_DB_NAME = browserIdentifiers.offlineDatabase.current;
export const LEGACY_OFFLINE_DB_NAMES = browserIdentifiers.offlineDatabase.legacy;
export const OFFLINE_DB_VERSION = 2;

const stores = {
  metadata: "metadata",
  rosters: "rosters",
  trustedStates: "trustedStates",
  pinVerifiers: "pinVerifiers",
  pinLockouts: "pinLockouts",
  pendingActions: "pendingActions",
  syncReceipts: "syncReceipts",
  localAudit: "localAudit",
} as const;

type MetadataRecord = {
  key: string;
  value: unknown;
};

let databasePromise: Promise<IDBDatabase> | null = null;

async function existingDatabaseNames(): Promise<Set<string>> {
  if (!("databases" in indexedDB)) return new Set();
  const values = await indexedDB.databases();
  return new Set(values.map((item) => item.name).filter((name): name is string => Boolean(name)));
}

async function migrateLegacyDatabase(database: IDBDatabase): Promise<void> {
  const names = await existingDatabaseNames();
  const legacyName = LEGACY_OFFLINE_DB_NAMES.find((name) => names.has(name));
  if (!legacyName) return;

  const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(legacyName);
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error ?? new Error("Legacy offline database could not open")));
  });
  try {
    const sharedStores = [...legacy.objectStoreNames].filter((name) => database.objectStoreNames.contains(name));
    if (!sharedStores.length) return;
    const sourceTransaction = legacy.transaction(sharedStores, "readonly");
    const records = await Promise.all(sharedStores.map(async (name) => [
      name,
      await requestResult<unknown[]>(sourceTransaction.objectStore(name).getAll()),
    ] as const));
    await transactionDone(sourceTransaction);

    const targetTransaction = database.transaction(sharedStores, "readwrite");
    for (const [name, values] of records) {
      const store = targetTransaction.objectStore(name);
      for (const value of values) {
        if (name === stores.pendingActions) {
          const action = value as Partial<PendingAttendanceAction>;
          store.put({
            ...action,
            clockConfidence: action.clockConfidence ?? "uncertain",
            elapsedSinceAuthorisationMs: action.elapsedSinceAuthorisationMs ?? null,
          });
        } else {
          store.put(value);
        }
      }
    }
    await transactionDone(targetTransaction);
  } finally {
    legacy.close();
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () =>
      reject(request.error ?? new Error("IndexedDB request failed")),
    );
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("abort", () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted")),
    );
    transaction.addEventListener("error", () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed")),
    );
  });
}

export function openOfflineDatabase(): Promise<IDBDatabase> {
  if (databasePromise) {
    return databasePromise;
  }

  databasePromise = new Promise((resolve, reject) => {
    let createdNewDatabase = false;
    const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);

    request.addEventListener("upgradeneeded", (event) => {
      const database = request.result;
      createdNewDatabase = (event as IDBVersionChangeEvent).oldVersion === 0;
      if (!database.objectStoreNames.contains(stores.metadata)) {
        database.createObjectStore(stores.metadata, { keyPath: "key" });
      }
      if (!database.objectStoreNames.contains(stores.rosters)) {
        database.createObjectStore(stores.rosters, { keyPath: "staffId" });
      }
      if (!database.objectStoreNames.contains(stores.trustedStates)) {
        database.createObjectStore(stores.trustedStates, {
          keyPath: "staffId",
        });
      }
      if (!database.objectStoreNames.contains(stores.pinVerifiers)) {
        database.createObjectStore(stores.pinVerifiers, {
          keyPath: ["staffId", "authorisationId"],
        });
      }
      if (!database.objectStoreNames.contains(stores.pinLockouts)) {
        database.createObjectStore(stores.pinLockouts, {
          keyPath: ["staffId", "authorisationId"],
        });
      }
      if (!database.objectStoreNames.contains(stores.pendingActions)) {
        const pendingActions = database.createObjectStore(
          stores.pendingActions,
          { keyPath: "idempotencyKey" },
        );
        pendingActions.createIndex("deviceSequence", "deviceSequence", {
          unique: true,
        });
        pendingActions.createIndex("staffId", "staffId");
        pendingActions.createIndex("status", "status");
      }
      if (!database.objectStoreNames.contains(stores.syncReceipts)) {
        database.createObjectStore(stores.syncReceipts, {
          keyPath: "idempotencyKey",
        });
      }
      if (!database.objectStoreNames.contains(stores.localAudit)) {
        database.createObjectStore(stores.localAudit, {
          keyPath: "id",
          autoIncrement: true,
        });
      }
      if ((event as IDBVersionChangeEvent).oldVersion < 2 && database.objectStoreNames.contains(stores.pendingActions)) {
        const pendingActions = request.transaction!.objectStore(stores.pendingActions);
        const cursorRequest = pendingActions.openCursor();
        cursorRequest.addEventListener("success", () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          const action = cursor.value as Partial<PendingAttendanceAction>;
          cursor.update({
            ...action,
            clockConfidence: action.clockConfidence ?? "uncertain",
            elapsedSinceAuthorisationMs: action.elapsedSinceAuthorisationMs ?? null,
          });
          cursor.continue();
        });
      }
    });
    request.addEventListener("success", async () => {
      const database = request.result;
      try {
        if (createdNewDatabase) {
          await migrateLegacyDatabase(database);
        }
        resolve(database);
      } catch (error) {
        database.close();
        databasePromise = null;
        reject(error);
      }
    });
    request.addEventListener("error", () => {
      databasePromise = null;
      reject(request.error ?? new Error("Offline database could not open"));
    });
    request.addEventListener("blocked", () => {
      databasePromise = null;
      reject(new Error("Offline database upgrade is blocked"));
    });
  });

  return databasePromise;
}

export async function closeOfflineDatabase(): Promise<void> {
  if (!databasePromise) {
    return;
  }
  const database = await databasePromise;
  database.close();
  databasePromise = null;
}

export async function deleteOfflineDatabase(): Promise<void> {
  await closeOfflineDatabase();
  for (const name of [OFFLINE_DB_NAME, ...LEGACY_OFFLINE_DB_NAMES]) {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.addEventListener("success", () => resolve());
      request.addEventListener("error", () =>
        reject(request.error ?? new Error("Offline database could not be deleted")),
      );
      request.addEventListener("blocked", () =>
        reject(new Error("Offline database deletion is blocked")),
      );
    });
  }
}

export async function resetOfflineDatabaseSafely(input: {
  managerAuthorised: boolean;
  reason: string;
  diagnosticExportConfirmed?: boolean;
}): Promise<
  | { status: "reset"; pendingCount: number }
  | { status: "blocked"; pendingCount: number; reason: "manager_required" | "reason_required" | "diagnostic_export_required" }
> {
  const actions = await listPendingActions({ includeDefinitive: true });
  const pendingCount = actions.filter((action) =>
    ["pending", "syncing", "conflicted"].includes(action.status),
  ).length;
  if (pendingCount > 0) {
    if (!input.managerAuthorised) {
      return { status: "blocked", pendingCount, reason: "manager_required" };
    }
    if (input.reason.trim().length < 5) {
      return { status: "blocked", pendingCount, reason: "reason_required" };
    }
    if (!input.diagnosticExportConfirmed) {
      return { status: "blocked", pendingCount, reason: "diagnostic_export_required" };
    }
  }
  await deleteOfflineDatabase();
  return { status: "reset", pendingCount };
}

export async function replaceRosterAtomically(
  snapshot: OfflineRosterSnapshot,
): Promise<void> {
  const database = await openOfflineDatabase();
  const transaction = database.transaction(
    [stores.metadata, stores.rosters],
    "readwrite",
  );
  const metadata = transaction.objectStore(stores.metadata);
  const rosters = transaction.objectStore(stores.rosters);
  const done = transactionDone(transaction);

  rosters.clear();
  for (const entry of snapshot.entries) {
    rosters.add({ ...entry, rosterVersion: snapshot.rosterVersion });
  }
  const snapshotMetadata: Omit<OfflineRosterSnapshot, "entries"> = {
    schemaVersion: snapshot.schemaVersion,
    rosterVersion: snapshot.rosterVersion,
    authorisationId: snapshot.authorisationId,
    issuedAt: snapshot.issuedAt,
    expiresAt: snapshot.expiresAt,
    serverTime: snapshot.serverTime,
  };
  metadata.put({
    key: "activeRoster",
    value: snapshotMetadata,
  } satisfies MetadataRecord);

  await done;
}

export async function getActiveRoster(): Promise<OfflineRosterSnapshot | null> {
  const database = await openOfflineDatabase();
  const transaction = database.transaction(
    [stores.metadata, stores.rosters],
    "readonly",
  );
  const metadataRequest = transaction
    .objectStore(stores.metadata)
    .get("activeRoster");
  const entriesRequest = transaction.objectStore(stores.rosters).getAll();
  const [metadata, storedEntries] = await Promise.all([
    requestResult<MetadataRecord | undefined>(metadataRequest),
    requestResult<Array<OfflineRosterSnapshot["entries"][number] & {
      rosterVersion: string;
    }>>(entriesRequest),
    transactionDone(transaction),
  ]);

  if (!metadata) {
    return null;
  }
  const snapshot = metadata.value as Omit<OfflineRosterSnapshot, "entries">;
  return {
    ...snapshot,
    entries: storedEntries
      .filter((entry) => entry.rosterVersion === snapshot.rosterVersion)
      .map((entry) => ({
        staffId: entry.staffId,
        displayName: entry.displayName,
        employmentRole: entry.employmentRole,
        offlineReady: entry.offlineReady,
        ...(entry.pinVersion ? { pinVersion: entry.pinVersion } : {}),
      }))
      .sort((left, right) => left.staffId.localeCompare(right.staffId)),
  };
}

export async function installOfflineProvisioningPackage(
  packageValue: OfflineProvisioningPackage,
): Promise<void> {
  const database = await openOfflineDatabase();
  const transaction = database.transaction(
    [stores.metadata, stores.rosters, stores.trustedStates],
    "readwrite",
  );
  const metadata = transaction.objectStore(stores.metadata);
  const rosters = transaction.objectStore(stores.rosters);
  const trustedStates = transaction.objectStore(stores.trustedStates);
  rosters.clear();
  trustedStates.clear();
  for (const entry of packageValue.roster) {
    rosters.add({
      staffId: entry.staffId,
      displayName: entry.displayName,
      employmentRole: entry.employmentRole,
      offlineReady: false,
      pinVersion: entry.pinVersion,
      rosterVersion: packageValue.authorisation.rosterVersion,
    });
    trustedStates.add({
      staffId: entry.staffId,
      rosterVersion: packageValue.authorisation.rosterVersion,
      state: structuredClone(entry.trustedState) as TrustedAttendanceState["state"],
      trustedAt: packageValue.server.time,
    } satisfies TrustedAttendanceState);
  }
  metadata.put({
    key: "activeRoster",
    value: {
      schemaVersion: 1,
      rosterVersion: packageValue.authorisation.rosterVersion,
      authorisationId: packageValue.authorisation.id,
      issuedAt: packageValue.authorisation.issuedAt,
      expiresAt: packageValue.authorisation.expiresAt,
      serverTime: packageValue.server.time,
    },
  } satisfies MetadataRecord);
  metadata.put({
    key: "offlineProvisioningPackage",
    value: structuredClone(packageValue),
  } satisfies MetadataRecord);
  await transactionDone(transaction);
}

export async function getOfflineProvisioningPackage(): Promise<OfflineProvisioningPackage | null> {
  const database = await openOfflineDatabase();
  const transaction = database.transaction(stores.metadata, "readonly");
  const request = transaction.objectStore(stores.metadata).get("offlineProvisioningPackage");
  const [record] = await Promise.all([
    requestResult<MetadataRecord | undefined>(request),
    transactionDone(transaction),
  ]);
  return (record?.value as OfflineProvisioningPackage | undefined) ?? null;
}

export async function putTrustedState(
  state: TrustedAttendanceState,
): Promise<void> {
  const database = await openOfflineDatabase();
  const transaction = database.transaction(stores.trustedStates, "readwrite");
  transaction.objectStore(stores.trustedStates).put(structuredClone(state));
  await transactionDone(transaction);
}

export async function getTrustedState(
  staffId: string,
): Promise<TrustedAttendanceState | null> {
  const database = await openOfflineDatabase();
  const transaction = database.transaction(stores.trustedStates, "readonly");
  const request = transaction
    .objectStore(stores.trustedStates)
    .get(staffId);
  const [result] = await Promise.all([
    requestResult<TrustedAttendanceState | undefined>(request),
    transactionDone(transaction),
  ]);
  return result ?? null;
}

export async function saveDeviceKeys(
  keys: DeviceSecurityKeys,
): Promise<void> {
  const database = await openOfflineDatabase();
  const transaction = database.transaction(stores.metadata, "readwrite");
  transaction.objectStore(stores.metadata).put({
    key: "deviceSecurityKeys",
    value: keys,
  } satisfies MetadataRecord);
  await transactionDone(transaction);
}

export async function getDeviceKeys(): Promise<DeviceSecurityKeys | null> {
  const database = await openOfflineDatabase();
  const transaction = database.transaction(stores.metadata, "readonly");
  const request = transaction
    .objectStore(stores.metadata)
    .get("deviceSecurityKeys");
  const [record] = await Promise.all([
    requestResult<MetadataRecord | undefined>(request),
    transactionDone(transaction),
  ]);
  return (record?.value as DeviceSecurityKeys | undefined) ?? null;
}

export async function putOfflinePinVerifier(
  envelope: OfflinePinVerifierEnvelope,
): Promise<void> {
  const database = await openOfflineDatabase();
  const transaction = database.transaction(stores.pinVerifiers, "readwrite");
  transaction.objectStore(stores.pinVerifiers).put(envelope);
  await transactionDone(transaction);
}

export async function getOfflinePinVerifier(
  staffId: string,
  authorisationId: string,
): Promise<OfflinePinVerifierEnvelope | null> {
  const database = await openOfflineDatabase();
  const transaction = database.transaction(stores.pinVerifiers, "readonly");
  const request = transaction
    .objectStore(stores.pinVerifiers)
    .get([staffId, authorisationId]);
  const [envelope] = await Promise.all([
    requestResult<OfflinePinVerifierEnvelope | undefined>(request),
    transactionDone(transaction),
  ]);
  return envelope ?? null;
}

export async function putOfflinePinLockout(
  lockout: OfflinePinLockout,
): Promise<void> {
  const database = await openOfflineDatabase();
  const transaction = database.transaction(stores.pinLockouts, "readwrite");
  transaction.objectStore(stores.pinLockouts).put(lockout);
  await transactionDone(transaction);
}

export async function getOfflinePinLockout(
  staffId: string,
  authorisationId: string,
): Promise<OfflinePinLockout | null> {
  const database = await openOfflineDatabase();
  const transaction = database.transaction(stores.pinLockouts, "readonly");
  const request = transaction
    .objectStore(stores.pinLockouts)
    .get([staffId, authorisationId]);
  const [lockout] = await Promise.all([
    requestResult<OfflinePinLockout | undefined>(request),
    transactionDone(transaction),
  ]);
  return lockout ?? null;
}

export async function enqueueAttendanceAction(
  input: UnsignedPendingAction,
): Promise<PendingAttendanceAction> {
  const database = await openOfflineDatabase();
  const transaction = database.transaction(
    [stores.metadata, stores.pendingActions],
    "readwrite",
  );
  const metadata = transaction.objectStore(stores.metadata);
  const sequenceRecord = await requestResult<MetadataRecord | undefined>(
    metadata.get("nextDeviceSequence"),
  );
  const deviceSequence =
    typeof sequenceRecord?.value === "number" ? sequenceRecord.value : 1;
  const action: PendingAttendanceAction = {
    ...structuredClone(input),
    clockConfidence: input.clockConfidence ?? "uncertain",
    elapsedSinceAuthorisationMs: input.elapsedSinceAuthorisationMs ?? null,
    schemaVersion: 1,
    deviceSequence,
    queueCreatedAt: new Date().toISOString(),
    status: "pending",
    retryCount: 0,
    lastErrorCategory: null,
  };

  metadata.put({
    key: "nextDeviceSequence",
    value: deviceSequence + 1,
  } satisfies MetadataRecord);
  transaction.objectStore(stores.pendingActions).add(action);
  await transactionDone(transaction);
  return action;
}

export async function reserveOfflineDeviceSequence(): Promise<number> {
  const database = await openOfflineDatabase();
  const transaction = database.transaction(stores.metadata, "readwrite");
  const metadata = transaction.objectStore(stores.metadata);
  const sequenceRecord = await requestResult<MetadataRecord | undefined>(
    metadata.get("nextDeviceSequence"),
  );
  const deviceSequence =
    typeof sequenceRecord?.value === "number" ? sequenceRecord.value : 1;
  metadata.put({
    key: "nextDeviceSequence",
    value: deviceSequence + 1,
  } satisfies MetadataRecord);
  await transactionDone(transaction);
  return deviceSequence;
}

export async function storePreparedPendingAction(
  action: PendingAttendanceAction,
): Promise<void> {
  const database = await openOfflineDatabase();
  const transaction = database.transaction(stores.pendingActions, "readwrite");
  transaction.objectStore(stores.pendingActions).add(structuredClone(action));
  await transactionDone(transaction);
}

export async function listPendingActions(
  options: { includeDefinitive?: boolean } = {},
): Promise<PendingAttendanceAction[]> {
  const database = await openOfflineDatabase();
  const transaction = database.transaction(stores.pendingActions, "readonly");
  const request = transaction.objectStore(stores.pendingActions).getAll();
  const [actions] = await Promise.all([
    requestResult<PendingAttendanceAction[]>(request),
    transactionDone(transaction),
  ]);

  return actions
    .filter(
      (action) =>
        options.includeDefinitive ||
        !["synced", "rejected"].includes(action.status),
    )
    .sort((left, right) => left.deviceSequence - right.deviceSequence);
}

async function updatePendingAction(
  idempotencyKey: string,
  update: (
    action: PendingAttendanceAction,
  ) => PendingAttendanceAction,
): Promise<void> {
  const database = await openOfflineDatabase();
  const transaction = database.transaction(stores.pendingActions, "readwrite");
  const pendingActions = transaction.objectStore(stores.pendingActions);
  const current = await requestResult<PendingAttendanceAction | undefined>(
    pendingActions.get(idempotencyKey),
  );
  if (!current) {
    transaction.abort();
    await transactionDone(transaction).catch(() => undefined);
    throw new Error("Pending attendance action does not exist");
  }
  pendingActions.put(update(current));
  await transactionDone(transaction);
}

export async function markPendingActionSyncing(
  idempotencyKey: string,
): Promise<void> {
  await updatePendingAction(idempotencyKey, (action) => ({
    ...action,
    status: "syncing",
    lastErrorCategory: null,
  }));
}

export async function markPendingActionRetryable(
  idempotencyKey: string,
  category: string,
): Promise<void> {
  await updatePendingAction(idempotencyKey, (action) => ({
    ...action,
    status: "pending",
    retryCount: action.retryCount + 1,
    lastErrorCategory: category,
  }));
}

export async function resetInterruptedSyncActions(): Promise<void> {
  const actions = await listPendingActions({ includeDefinitive: true });
  for (const action of actions) {
    if (action.status === "syncing") {
      await markPendingActionRetryable(
        action.idempotencyKey,
        "interrupted_sync",
      );
    }
  }
}

export async function acquireSyncLease(input: {
  ownerId: string;
  now: string;
  leaseMilliseconds?: number;
}): Promise<boolean> {
  const now = new Date(input.now).getTime();
  if (Number.isNaN(now)) {
    throw new RangeError("Sync lease requires a valid timestamp");
  }
  const database = await openOfflineDatabase();
  const transaction = database.transaction(stores.metadata, "readwrite");
  const metadata = transaction.objectStore(stores.metadata);
  const current = await requestResult<MetadataRecord | undefined>(
    metadata.get("syncLease"),
  );
  const lease = current?.value as
    | { ownerId: string; expiresAt: string }
    | undefined;
  if (
    lease &&
    lease.ownerId !== input.ownerId &&
    new Date(lease.expiresAt).getTime() > now
  ) {
    await transactionDone(transaction);
    return false;
  }

  metadata.put({
    key: "syncLease",
    value: {
      ownerId: input.ownerId,
      expiresAt: new Date(
        now + (input.leaseMilliseconds ?? 30_000),
      ).toISOString(),
    },
  } satisfies MetadataRecord);
  await transactionDone(transaction);
  return true;
}

export async function releaseSyncLease(ownerId: string): Promise<void> {
  const database = await openOfflineDatabase();
  const transaction = database.transaction(stores.metadata, "readwrite");
  const metadata = transaction.objectStore(stores.metadata);
  const current = await requestResult<MetadataRecord | undefined>(
    metadata.get("syncLease"),
  );
  const lease = current?.value as { ownerId: string } | undefined;
  if (lease?.ownerId === ownerId) {
    metadata.delete("syncLease");
  }
  await transactionDone(transaction);
}

export async function persistSyncReceipt(
  input: SyncReceiptTransaction,
): Promise<void> {
  const database = await openOfflineDatabase();
  const transaction = database.transaction(
    [stores.pendingActions, stores.syncReceipts, stores.trustedStates],
    "readwrite",
  );
  const pendingActions = transaction.objectStore(stores.pendingActions);
  const current = await requestResult<PendingAttendanceAction | undefined>(
    pendingActions.get(input.actionId),
  );
  if (!current) {
    transaction.abort();
    await transactionDone(transaction).catch(() => undefined);
    throw new Error("Pending attendance action does not exist");
  }

  pendingActions.put({
    ...current,
    status: input.definitiveStatus,
  });
  transaction.objectStore(stores.syncReceipts).put(input.receipt);
  transaction
    .objectStore(stores.trustedStates)
    .put(structuredClone(input.trustedState));
  await transactionDone(transaction);
}

export async function getSyncReceipt(
  idempotencyKey: string,
): Promise<OfflineSyncReceipt | null> {
  const database = await openOfflineDatabase();
  const transaction = database.transaction(stores.syncReceipts, "readonly");
  const request = transaction
    .objectStore(stores.syncReceipts)
    .get(idempotencyKey);
  const [receipt] = await Promise.all([
    requestResult<OfflineSyncReceipt | undefined>(request),
    transactionDone(transaction),
  ]);
  return receipt ?? null;
}

export async function getOfflineQueueSummary(): Promise<{
  pendingCount: number;
  conflictCount: number;
  oldestPendingActionAt: string | null;
  lastSuccessfulSyncAt: string | null;
}> {
  const database = await openOfflineDatabase();
  const transaction = database.transaction(
    [stores.pendingActions, stores.syncReceipts],
    "readonly",
  );
  const [actions, receipts] = await Promise.all([
    requestResult<PendingAttendanceAction[]>(
      transaction.objectStore(stores.pendingActions).getAll(),
    ),
    requestResult<OfflineSyncReceipt[]>(
      transaction.objectStore(stores.syncReceipts).getAll(),
    ),
    transactionDone(transaction),
  ]);
  const unresolved = actions.filter((action) =>
    ["pending", "syncing", "conflicted"].includes(action.status),
  );
  let oldestPendingActionAt: string | null = null;
  for (const action of unresolved) {
    if (!oldestPendingActionAt || action.queueCreatedAt < oldestPendingActionAt) {
      oldestPendingActionAt = action.queueCreatedAt;
    }
  }
  let lastSuccessfulSyncAt: string | null = null;
  for (const receipt of receipts) {
    if (receipt.outcome === "synced"
      && (!lastSuccessfulSyncAt || receipt.receivedAtServer > lastSuccessfulSyncAt)) {
      lastSuccessfulSyncAt = receipt.receivedAtServer;
    }
  }
  return {
    pendingCount: unresolved.length,
    conflictCount: unresolved.filter((action) => action.status === "conflicted").length,
    oldestPendingActionAt,
    lastSuccessfulSyncAt,
  };
}

export async function cleanupOfflineData(now: string): Promise<void> {
  const nowTime = new Date(now).getTime();
  if (Number.isNaN(nowTime)) {
    throw new RangeError("Offline cleanup requires a valid timestamp");
  }
  const definitiveCutoff =
    nowTime - OFFLINE_DEFINITIVE_QUEUE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const database = await openOfflineDatabase();
  const transaction = database.transaction(
    [stores.pendingActions, stores.syncReceipts],
    "readwrite",
  );
  const pendingActions = transaction.objectStore(stores.pendingActions);
  const syncReceipts = transaction.objectStore(stores.syncReceipts);
  const [actions, receipts] = await Promise.all([
    requestResult<PendingAttendanceAction[]>(pendingActions.getAll()),
    requestResult<OfflineSyncReceipt[]>(syncReceipts.getAll()),
  ]);

  for (const action of actions) {
    const createdAt = new Date(action.queueCreatedAt).getTime();
    if (
      ["synced", "rejected"].includes(action.status) &&
      createdAt < definitiveCutoff
    ) {
      pendingActions.delete(action.idempotencyKey);
    }
  }
  for (const receipt of receipts) {
    if (new Date(receipt.retainedUntil).getTime() <= nowTime) {
      syncReceipts.delete(receipt.idempotencyKey);
    }
  }

  await transactionDone(transaction);
}
