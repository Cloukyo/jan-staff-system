"use client";

import { useActionState } from "react";
import { KeyRound } from "lucide-react";
import { BrandMark } from "@/components/ui/brand";
import { Button, Field, Panel, inputClassName } from "@/components/ui/primitives";
import { changeRequiredPasswordAction, type ChangePasswordActionState } from "@/lib/auth/actions";

const initialState: ChangePasswordActionState = { ok: false, message: "" };

export function ChangePasswordScreen() {
  const [state, action, pending] = useActionState(changeRequiredPasswordAction, initialState);
  return (
    <main className="grid min-h-screen place-items-center bg-lavender px-4 py-10">
      <Panel className="w-full max-w-md">
        <BrandMark />
        <KeyRound className="mt-8 h-8 w-8 text-purple-700" aria-hidden />
        <h1 className="mt-3 text-3xl font-black text-purple-950">Choose a private password</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Your temporary password must be replaced before you can use staff or manager screens.</p>
        <form className="mt-6 grid gap-4" action={action}>
          <Field label="New password">
            <input className={inputClassName("w-full")} name="password" type="password" minLength={12} autoComplete="new-password" required />
          </Field>
          <Field label="Confirm new password">
            <input className={inputClassName("w-full")} name="confirmation" type="password" minLength={12} autoComplete="new-password" required />
          </Field>
          <p className="text-xs leading-5 text-slate-600">Use at least 12 characters with uppercase, lowercase, a number and a symbol.</p>
          {state.message ? <p className="rounded-lg bg-red-50 p-3 text-sm font-bold text-red-800">{state.message}</p> : null}
          <Button type="submit" disabled={pending}>{pending ? "Changing password..." : "Change password"}</Button>
        </form>
      </Panel>
    </main>
  );
}
