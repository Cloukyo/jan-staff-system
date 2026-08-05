"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadOfflineRuntimeState, reportOfflineQueueHealth } from "@/lib/kiosk/offline/runtime";
import { refreshOfflineProvisioning } from "@/lib/kiosk/offline/provisioning";
import { syncPendingActions } from "@/lib/kiosk/offline/sync";
import { OFFLINE_KIOSK_RUNTIME_ENABLED } from "@/lib/kiosk/offline/feature";
import type { OfflineSyncTrigger } from "@/lib/kiosk/offline/types";
import type { OfflineRuntimeState } from "@/lib/kiosk/offline/runtime";
import { browserIdentifiers } from "@/lib/platform/browser-identifiers";

export type OfflineConnectionState =
  | "online"
  | "offline"
  | "synchronising"
  | "sync_problem"
  | "revoked"
  | "update_required";

const emptyRuntime: OfflineRuntimeState = {
  lifecycle: "disabled",
  package: null,
  pendingCount: 0,
  conflictCount: 0,
  oldestPendingActionAt: null,
  lastSuccessfulSyncAt: null,
};

async function requestBackgroundSync() {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.ready;
  const sync = (registration as ServiceWorkerRegistration & {
    sync?: { register(tag: string): Promise<void> };
  }).sync;
  await sync?.register(browserIdentifiers.backgroundSync.current).catch(() => undefined);
}

export function useOfflineKiosk() {
  const [connection, setConnection] = useState<OfflineConnectionState>("online");
  const [runtime, setRuntime] = useState<OfflineRuntimeState>(emptyRuntime);
  const inFlight = useRef<Promise<void> | null>(null);

  const refreshLocal = useCallback(async () => {
    const next = await loadOfflineRuntimeState();
    setRuntime(next);
    return next;
  }, []);

  const maintain = useCallback((trigger: OfflineSyncTrigger) => {
    if (inFlight.current) return inFlight.current;
    const task = (async () => {
      if (!OFFLINE_KIOSK_RUNTIME_ENABLED) {
        setConnection("online");
        await refreshLocal();
        return;
      }
      if (trigger === "manual") setConnection("synchronising");
      let healthResponse: Response;
      try {
        healthResponse = await fetch("/api/kiosk/offline/health", {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
        });
      } catch {
        setConnection("offline");
        await refreshLocal();
        return;
      }

      let healthBody: { health?: { active?: boolean; revokedAt?: string | null; acceptedSchemaVersion?: number } } = {};
      try {
        healthBody = await healthResponse.json() as typeof healthBody;
      } catch {
        healthBody = {};
      }
      if (healthBody.health?.revokedAt || healthBody.health?.active === false) {
        setConnection("revoked");
      } else if (healthBody.health?.acceptedSchemaVersion
        && healthBody.health.acceptedSchemaVersion !== 1) {
        setConnection("update_required");
      } else {
        setConnection("online");
      }

      const provisioning = await refreshOfflineProvisioning();
      if (provisioning.status === "device_revoked") setConnection("revoked");
      if (provisioning.status === "schema_incompatible") setConnection("update_required");
      const updateRequired = healthBody.health?.acceptedSchemaVersion !== undefined
        && healthBody.health.acceptedSchemaVersion !== 1
        || provisioning.status === "schema_incompatible";

      const beforeSync = await refreshLocal();
      if (!updateRequired && beforeSync.pendingCount > 0) {
        setConnection("synchronising");
        const summary = await syncPendingActions(trigger);
        if (summary.retryableFailures > 0) setConnection("sync_problem");
        else if (summary.conflicted > 0) setConnection("online");
        else setConnection("online");
      }
      await refreshLocal();
      await reportOfflineQueueHealth();
    })().finally(() => {
      inFlight.current = null;
    });
    inFlight.current = task;
    return task;
  }, [refreshLocal]);

  useEffect(() => {
    if (!OFFLINE_KIOSK_RUNTIME_ENABLED) {
      return;
    }
    void maintain("launch");
    const online = () => void maintain("online");
    const offline = () => {
      setConnection("offline");
      void refreshLocal();
    };
    const visibility = () => {
      if (document.visibilityState === "visible") void maintain("visibility");
    };
    const message = (event: MessageEvent) => {
      if (event.data?.type === "OFFLINE_SYNC_REQUESTED") void maintain("background");
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", visibility);
    navigator.serviceWorker?.addEventListener("message", message);
    const timer = window.setInterval(() => void maintain("periodic"), 60_000);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", visibility);
      navigator.serviceWorker?.removeEventListener("message", message);
      window.clearInterval(timer);
    };
  }, [maintain, refreshLocal]);

  const queueChanged = useCallback(async () => {
    const next = await refreshLocal();
    if (OFFLINE_KIOSK_RUNTIME_ENABLED && next.pendingCount > 0) {
      await requestBackgroundSync();
    }
  }, [refreshLocal]);

  return {
    connection,
    runtime,
    offlineUsable: OFFLINE_KIOSK_RUNTIME_ENABLED && connection === "offline"
      && ["active", "expiring"].includes(runtime.lifecycle),
    syncNow: () => maintain("manual"),
    queueChanged,
  };
}
