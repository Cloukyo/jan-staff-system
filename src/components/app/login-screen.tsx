"use client";

import { useActionState } from "react";
import { KeyRound, Mail } from "lucide-react";
import { signInAction, resetPasswordAction, type AuthActionState } from "@/lib/auth/actions";
import { BrandMark } from "@/components/ui/brand";
import { Button, Field, Panel, inputClassName } from "@/components/ui/primitives";
import { PasswordInput } from "@/components/ui/password-input";

const initialState: AuthActionState = { message: "" };

export function LoginScreen({ notice }: { notice?: string }) {
  const [loginState, loginFormAction, loginPending] = useActionState(signInAction, initialState);
  const [resetState, resetFormAction, resetPending] = useActionState(resetPasswordAction, initialState);

  return (
    <main className="grid min-h-screen place-items-center bg-lavender px-4 py-10">
      <Panel className="w-full max-w-md">
        <BrandMark />
        <h1 className="mt-8 text-3xl font-black text-purple-950">Staff login</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Sign in with the email address linked to your Jan Pre-School staff account.</p>
        {notice ? <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{notice}</p> : null}
        <form className="mt-6 grid gap-4" action={loginFormAction}>
          <Field label="Email">
            <div className="relative">
              <Mail className="absolute left-3 top-3 h-5 w-5 text-purple-400" aria-hidden />
              <input className={inputClassName("w-full pl-10")} name="email" type="email" autoComplete="email" required />
            </div>
          </Field>
          <Field label="Password">
            <PasswordInput
              autoComplete="current-password"
              leftIcon={<KeyRound className="h-5 w-5" aria-hidden />}
              name="password"
              required
            />
          </Field>
          {loginState.message && <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-800">{loginState.message}</p>}
          <Button type="submit" disabled={loginPending}>{loginPending ? "Signing in..." : "Sign in"}</Button>
        </form>
        <form className="mt-5 border-t border-purple-100 pt-5" action={resetFormAction}>
          <p className="text-sm font-bold text-purple-950">Forgotten password</p>
          <p className="mt-1 text-sm text-slate-600">Request a Supabase reset email for an active staff account.</p>
          <Field label="Reset email">
            <input className={inputClassName("mt-2 w-full")} name="email" type="email" autoComplete="email" required />
          </Field>
          {resetState.message && <p className="mt-3 rounded-xl bg-purple-50 p-3 text-sm font-semibold text-purple-800">{resetState.message}</p>}
          <Button className="mt-3 w-full" variant="secondary" type="submit" disabled={resetPending}>
            {resetPending ? "Sending..." : "Send reset email"}
          </Button>
        </form>
      </Panel>
    </main>
  );
}
