"use client";

import { useActionState } from "react";
import { resetPersonPassword, type ResetPasswordState } from "./password-actions";

const initialState: ResetPasswordState = {};

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState(resetPersonPassword, initialState);
  return (
    <form className="profile-notifications join-settings" action={action} aria-labelledby="reset-password-heading">
      <h2 id="reset-password-heading">Reset someone’s password</h2>
      <p>For someone who forgot theirs. Set a temporary password and tell them privately.</p>
      <div className="auth-form">
        <label htmlFor="reset-email">Their email</label>
        <input id="reset-email" name="email" type="email" autoComplete="off" required disabled={pending} />
        <label htmlFor="reset-password">Temporary password</label>
        <input id="reset-password" name="password" type="text" autoComplete="off" minLength={8} required disabled={pending} />
        <button type="submit" disabled={pending}>{pending ? "Setting…" : "Set password"}</button>
        {state.message ? <p className={`auth-message${state.status === "error" ? " auth-message--error" : ""}`} role="status" aria-live="polite">{state.message}</p> : null}
      </div>
    </form>
  );
}
