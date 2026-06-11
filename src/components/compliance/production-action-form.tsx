"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/primitives";
import type { ComplianceActionState } from "@/lib/compliance/actions";

const initialState: ComplianceActionState = { ok: false, message: "" };

export function ProductionActionForm({
  action,
  children,
  submitLabel = "Save",
  submitVariant = "primary",
  className = "",
}: {
  action: (state: ComplianceActionState, formData: FormData) => Promise<ComplianceActionState>;
  children: React.ReactNode;
  submitLabel?: string;
  submitVariant?: "primary" | "secondary" | "danger" | "ghost";
  className?: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, initialState);
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [router, state.ok]);
  return (
    <form action={formAction} className={className}>
      {children}
      {state.message && <p className={`mt-3 rounded-xl p-3 text-sm font-bold ${state.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>{state.message}</p>}
      <Button className="mt-3" type="submit" variant={submitVariant} disabled={pending}>{pending ? "Saving..." : submitLabel}</Button>
    </form>
  );
}
