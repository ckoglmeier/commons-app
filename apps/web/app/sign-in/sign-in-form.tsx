"use client";

import { useActionState } from "react";
import { requestSignInLink, type SignInState } from "./actions";

const initialState: SignInState = {};

export function SignInForm({
  next,
  enabled,
  submitLabel = "Send sign-in link",
  intent = "sign-in",
}: {
  next: string;
  enabled: boolean;
  submitLabel?: string;
  intent?: "sign-in" | "create" | "invited" | "access";
}) {
  const [emailState, emailAction, emailPending] = useActionState(requestSignInLink, initialState);

  return (
    <form className="auth-form" action={emailAction}>
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="intent" value={intent} />
      <label htmlFor="email">Email</label>
      <input id="email" name="email" type="email" autoComplete="email" inputMode="email" placeholder="you@example.com" required disabled={!enabled || emailPending} />
      <button type="submit" disabled={!enabled || emailPending}>{emailPending ? "Sending…" : submitLabel}</button>
      {emailState.message ? <p className={`auth-message auth-message--${emailState.status === "error" ? "error" : "sent"}`} role="status" aria-live="polite">{emailState.message}</p> : null}
    </form>
  );
}
