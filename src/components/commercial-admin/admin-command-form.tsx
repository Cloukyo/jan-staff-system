"use client";

import { useActionState, useState } from "react";
import { commercialAdminAction } from "@/lib/commercial-admin/actions";
import { initialCommercialAdminActionState } from "@/lib/commercial-admin/action-state";
import type { CommercialAdminCommandName } from "@/lib/commercial-admin/contracts";
import { Button } from "@/components/ui/primitives";

export function AdminCommandForm({ commandName, revision, submitLabel = "Save changes", tone = "primary", confirmMessage, children, className = "" }: {
  commandName: CommercialAdminCommandName; revision: number; submitLabel?: string; tone?: "primary" | "secondary" | "danger"; confirmMessage?: string; children: React.ReactNode; className?: string;
}) {
  const [state, action, pending] = useActionState(commercialAdminAction, initialCommercialAdminActionState);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  return (
    <form action={action} className={`grid gap-4 ${className}`} onSubmit={(event) => { if (confirmMessage && !window.confirm(confirmMessage)) event.preventDefault(); }}>
      <input type="hidden" name="commandName" value={commandName}/>
      <input type="hidden" name="expectedRevision" value={revision}/>
      <input type="hidden" name="idempotencyKey" value={idempotencyKey}/>
      {children}
      {state.message ? <div role="status" className={`rounded-lg px-4 py-3 text-sm font-semibold ${state.ok ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-950"}`}>{state.message}</div> : null}
      {state.oneTimeCode ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-4"><p className="text-sm font-bold text-amber-950">Copy this code now</p><code className="mt-2 block break-all text-sm text-amber-950">{state.oneTimeCode}</code><p className="mt-2 text-xs text-amber-900">For security, it will not be shown again.</p></div> : null}
      <Button type="submit" variant={tone} disabled={pending}>{pending ? "Saving…" : submitLabel}</Button>
    </form>
  );
}
