"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/primitives";
import type { RotaActionState } from "@/lib/rota/actions";

const initialState: RotaActionState = { ok: false, message: "" };

export function RotaActionForm({
  action,
  children,
  submitLabel,
  pendingLabel = "Saving...",
  variant = "primary",
  className = "",
  confirmMessage,
}: {
  action: (state: RotaActionState, formData: FormData) => Promise<RotaActionState>;
  children: React.ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  className?: string;
  confirmMessage?: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, initialState);
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [router, state.ok]);
  return (
    <form
      action={formAction}
      className={className}
      onSubmit={(event) => {
        if (confirmMessage && !window.confirm(confirmMessage)) event.preventDefault();
      }}
    >
      {children}
      {state.message ? <p className={`mt-2 text-sm font-bold ${state.ok ? "text-green-700" : "text-red-700"}`}>{state.message}</p> : null}
      <Button type="submit" variant={variant} disabled={pending}>{pending ? pendingLabel : submitLabel}</Button>
    </form>
  );
}
