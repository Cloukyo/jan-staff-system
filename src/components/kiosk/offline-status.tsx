"use client";

import { Wifi, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { formatDateUk, formatTimeUk } from "@/lib/dates/format";
import { offlineKioskStatus } from "@/lib/kiosk/presentation";
import type { OfflineConnectionState } from "@/components/kiosk/use-offline-kiosk";
import type { OfflineRuntimeState } from "@/lib/kiosk/offline/runtime";

export function OfflineStatus({ connection, runtime, onSync }: { connection: OfflineConnectionState; runtime: OfflineRuntimeState; onSync: () => void }) {
  const status = offlineKioskStatus(connection, runtime);
  const colour = status.tone === "green" ? "border-green-200 bg-green-50 text-green-900" : status.tone === "red" ? "border-red-300 bg-red-50 text-red-950" : "border-amber-300 bg-amber-50 text-amber-950";
  return (
    <section className={`mt-4 rounded-xl border p-4 ${colour}`} aria-live="polite" aria-atomic="true">
      <div className="flex items-start gap-3">
        {status.tone === "green" ? <Wifi className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" /> : <WifiOff className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />}
        <div className="min-w-0 flex-1"><p className="font-black">{status.heading}</p><p className="mt-1 text-sm font-semibold text-slate-700">{status.body}</p></div>
      </div>
      {(connection !== "online" || runtime.pendingCount > 0) ? (
        <details className="mt-3 border-t border-current/20 pt-2 text-slate-700">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-bold">Connection details</summary>
          <div className="grid gap-2 pb-1 text-xs font-semibold">
            <p>Saved actions waiting: {runtime.pendingCount}</p>
            <p>Last successful connection: {runtime.lastSuccessfulSyncAt ? `${formatDateUk(runtime.lastSuccessfulSyncAt)} at ${formatTimeUk(runtime.lastSuccessfulSyncAt)}` : "Not yet"}</p>
            {runtime.oldestPendingActionAt ? <p>Oldest saved action: {formatDateUk(runtime.oldestPendingActionAt)} at {formatTimeUk(runtime.oldestPendingActionAt)}</p> : null}
            <Button className="mt-1 w-full sm:w-fit" variant="secondary" disabled={connection === "synchronising"} onClick={onSync}>{connection === "synchronising" ? "Updating" : "Try connection now"}</Button>
          </div>
        </details>
      ) : null}
    </section>
  );
}
