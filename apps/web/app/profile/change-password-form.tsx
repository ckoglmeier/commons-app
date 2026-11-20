"use client";

import { useActionState } from "react";
import { changeOwnPassword, type ChangePasswordState } from "./password-actions";

const initialState: ChangePasswordState = {};

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changeOwnPassword, initialState);
  return (
    <form className="profile-notifications" action={action} aria-labelledby="profile-password-heading">
      <h2 id="profile-password-heading">Password</h2>
      <div className="auth-form">
        <label htmlFor="new-password">New password</label>
        <input id="new-password" name="password" type="password" autoComplete="new-password" minLength={8} required disabled={pending} />
        <button type="submit" disabled={pending}>{pending ? "Saving…" : "Change password"}</button>
        {state.message ? <p className={`auth-message${state.status === "error" ? " auth-message--error" : ""}`} role="status" aria-live="polite">{state.message}</p> : null}
      </div>
    </form>
  );
}
