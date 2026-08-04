"use client";

import { Button } from "@/components/ui/primitives";
import { formatDateUk, formatTimeUk } from "@/lib/dates/format";
import type { OfflineConnectionState } from "@/components/kiosk/use-offline-kiosk";
import type { OfflineRuntimeState } from "@/lib/kiosk/offline/runtime";

function statusLabel(connection: OfflineConnectionState, runtime: OfflineRuntimeState) {
  if (connection === "revoked") return "Device revoked";
  if (connection === "update_required") return "Update required";
  if (runtime.lifecycle === "expired") return "Authorisation expired";
  if (runtime.lifecycle === "expiring") return "Authorisation expiring";
  if (connection === "synchronising") return "Synchronising";
  if (runtime.conflictCount > 0) return "Sync conflict";
  if (connection === "sync_problem") return "Sync problem";
  if (connection === "offline") return "Offline - actions will sync later";
  return "Online";
}

export function OfflineStatus({
  connection,
  runtime,
  onSync,
}: {
  connection: OfflineConnectionState;
  runtime: OfflineRuntimeState;
  onSync: () => void;
}) {
  const warning = connection !== "online" || runtime.pendingCount > 0
    || runtime.conflictCount > 0 || runtime.lifecycle === "expiring";
  return (
    <section className={`mt-4 rounded-xl border p-4 ${warning ? "border-amber-300 bg-amber-50" : "border-green-200 bg-green-50"}`} aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className={`font-black ${warning ? "text-amber-950" : "text-green-900"}`}>{statusLabel(connection, runtime)}</p>
          <p className="mt-1 text-sm font-semibold text-slate-700">Pending actions: {runtime.pendingCount}</p>
          <p className="mt-1 text-xs text-slate-600">
            Last successful sync: {runtime.lastSuccessfulSyncAt
              ? `${formatDateUk(runtime.lastSuccessfulSyncAt)} ${formatTimeUk(runtime.lastSuccessfulSyncAt)}`
              : "Not yet"}
          </p>
          {runtime.oldestPendingActionAt ? <p className="mt-1 text-xs text-slate-600">Oldest pending action: {formatDateUk(runtime.oldestPendingActionAt)} {formatTimeUk(runtime.oldestPendingActionAt)}</p> : null}
          {runtime.conflictCount > 0 ? <p className="mt-2 text-sm font-bold text-red-700">A manager must review {runtime.conflictCount} synchronisation conflict(s).</p> : null}
        </div>
        <Button variant="secondary" disabled={connection === "synchronising"} onClick={onSync}>Sync now</Button>
      </div>
    </section>
  );
}
