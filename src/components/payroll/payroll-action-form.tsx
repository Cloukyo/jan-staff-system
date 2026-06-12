"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/primitives";
import type { PayrollActionState } from "@/lib/payroll/actions";

const initialState: PayrollActionState = { ok: false, message: "" };

export function PayrollActionForm({
  action,
  children,
  submitLabel,
  className = "",
}: {
  action: (state: PayrollActionState, formData: FormData) => Promise<PayrollActionState>;
  children: React.ReactNode;
  submitLabel: string;
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
      {state.message && <p className={`mt-3 text-sm font-bold ${state.ok ? "text-green-700" : "text-red-700"}`}>{state.message}</p>}
      <Button className="mt-3" type="submit" disabled={pending}>{pending ? "Saving..." : submitLabel}</Button>
    </form>
  );
}
