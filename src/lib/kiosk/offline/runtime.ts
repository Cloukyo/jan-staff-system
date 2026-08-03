import {
  getOfflineProvisioningPackage,
  getOfflineQueueSummary,
} from "@/lib/kiosk/offline/database";
import { OFFLINE_APP_VERSION } from "@/lib/kiosk/offline/provisioning";

export type OfflineRuntimeState = Awaited<ReturnType<typeof loadOfflineRuntimeState>>;

export async function loadOfflineRuntimeState(now = new Date().toISOString()) {
  const [packageValue, queue] = await Promise.all([
    getOfflineProvisioningPackage(),
    getOfflineQueueSummary(),
  ]);
  if (!packageValue) {
    return { lifecycle: "disabled" as const, package: null, ...queue };
  }
  const current = new Date(now).getTime();
  const expiry = new Date(packageValue.authorisation.expiresAt).getTime();
  const lifecycle = current >= expiry
    ? "expired" as const
    : expiry - current <= 2 * 60 * 60 * 1000
      ? "expiring" as const
      : "active" as const;
  return { lifecycle, package: packageValue, ...queue };
}

export async function reportOfflineQueueHealth(input: {
  fetcher?: typeof fetch;
  storage?: Pick<StorageManager, "persisted" | "estimate">;
} = {}): Promise<boolean> {
  const state = await loadOfflineRuntimeState();
  if (!state.package) return false;
  const storage = input.storage
    ?? (typeof navigator !== "undefined" ? navigator.storage : undefined);
  const [storagePersisted, estimate] = await Promise.all([
    storage?.persisted?.().catch(() => false) ?? Promise.resolve(false),
    storage?.estimate?.().catch(() => ({ usage: 0 })) ?? Promise.resolve({ usage: 0 }),
  ]);
  try {
    const response = await (input.fetcher ?? fetch)("/api/kiosk/offline/health", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        authorisationId: state.package.authorisation.id,
        pendingCount: state.pendingCount,
        oldestPendingActionAt: state.oldestPendingActionAt,
        storagePersisted,
        storageEstimateBytes: Math.round(estimate.usage ?? 0),
        appVersion: OFFLINE_APP_VERSION,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
