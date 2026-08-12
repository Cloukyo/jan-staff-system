"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button, Field, inputClassName } from "@/components/ui/primitives";
import { PasswordInput } from "@/components/ui/password-input";
import { signUpAction, type SignUpActionState } from "@/lib/auth/actions";

const initialState: SignUpActionState = { ok: false, message: "", email: "" };

export function SignupForm() {
  const [state, action, pending] = useActionState(signUpAction, initialState);
  return (
    <form action={action} className="onboarding-signup-form">
      <Field label="Work email"><input className={inputClassName()} name="email" type="email" defaultValue={state.email} autoComplete="email" required /></Field>
      <Field label="Password"><PasswordInput name="password" autoComplete="new-password" required /></Field>
      <Field label="Confirm password"><PasswordInput name="confirmation" autoComplete="new-password" required /></Field>
      {state.message ? <p className={state.ok ? "onboarding-auth-message onboarding-auth-message--success" : "onboarding-auth-message"} role="status">{state.message}</p> : null}
      <Button type="submit" disabled={pending}>{pending ? "Creating account..." : "Create owner account"}</Button>
      <p className="onboarding-auth-switch">Already registered? <Link href="/login">Sign in</Link></p>
    </form>
  );
}
