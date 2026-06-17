"use client";

import { useActionState } from "react";
import { KeyRound } from "lucide-react";
import { BrandMark } from "@/components/ui/brand";
import { Button, Field, Panel } from "@/components/ui/primitives";
import { PasswordInput } from "@/components/ui/password-input";
import { resetRecoveredPasswordAction, type ChangePasswordActionState } from "@/lib/auth/actions";

const initialState: ChangePasswordActionState = { ok: false, message: "" };

export function ResetPasswordScreen() {
  const [state, action, pending] = useActionState(resetRecoveredPasswordAction, initialState);

  return (
    <main className="grid min-h-screen place-items-center bg-lavender px-4 py-10">
      <Panel className="w-full max-w-md">
        <BrandMark />
        <KeyRound className="mt-8 h-8 w-8 text-purple-700" aria-hidden />
        <h1 className="mt-3 text-3xl font-black text-purple-950">Reset your password</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Choose a new private password for your staff account.</p>
        <form className="mt-6 grid gap-4" action={action}>
          <Field label="New password">
            <PasswordInput name="password" minLength={12} autoComplete="new-password" required />
          </Field>
          <Field label="Confirm new password">
            <PasswordInput name="confirmation" minLength={12} autoComplete="new-password" required />
          </Field>
          <p className="text-xs leading-5 text-slate-600">Use at least 12 characters with uppercase, lowercase, a number and a symbol. Do not include your email name.</p>
          {state.message ? <p className="rounded-lg bg-red-50 p-3 text-sm font-bold text-red-800">{state.message}</p> : null}
          <Button type="submit" disabled={pending}>{pending ? "Saving password..." : "Save new password"}</Button>
        </form>
      </Panel>
    </main>
  );
}
