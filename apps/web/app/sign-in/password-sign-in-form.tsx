"use client";

import { useActionState, useState } from "react";
import { signInWithPassword, type SignInState } from "./actions";

const initialState: SignInState = {};

/** Email and password, for copies of Commons with no email set up. New people choose Create account. */
export function PasswordSignInForm({ next, intent = "sign-in" }: { next: string; intent?: "sign-in" | "create" | "invited" }) {
  const [mode, setMode] = useState<"sign-in" | "create">(intent === "sign-in" ? "sign-in" : "create");
  const [state, action, pending] = useActionState(signInWithPassword, initialState);
  const creating = mode === "create";

  return (
    <form className="auth-form auth-form--password" action={action}>
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="mode" value={mode} />
      <label htmlFor="email">Email</label>
      <input id="email" name="email" type="email" autoComplete="email" inputMode="email" placeholder="you@example.com" defaultValue={state.email ?? ""} required disabled={pending} />
      <label htmlFor="password">{creating ? "Choose a password" : "Password"}</label>
      <input id="password" name="password" type="password" autoComplete={creating ? "new-password" : "current-password"} minLength={8} required disabled={pending} />
      {creating ? <p className="auth-hint">At least 8 characters.</p> : null}
      <button type="submit" disabled={pending}>{pending ? (creating ? "Creating…" : "Signing in…") : creating ? "Create account" : "Sign in"}</button>
      <button type="button" className="auth-switch" onClick={() => setMode(creating ? "sign-in" : "create")} disabled={pending}>
        {creating ? "Already have an account? Sign in" : "New here? Create an account"}
      </button>
      {state.message ? <p className="auth-message auth-message--error" role="alert">{state.message}</p> : null}
    </form>
  );
}
