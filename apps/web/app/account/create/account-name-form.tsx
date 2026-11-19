"use client";

import { useActionState } from "react";
import { completeAccount, type CreateAccountState } from "./actions";

const initialState: CreateAccountState = {};

export function AccountNameForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(completeAccount, initialState);
  return (
    <form className="auth-form" action={action}>
      <input type="hidden" name="next" value={next} />
      <label htmlFor="accountFirstName">First name</label>
      <input id="accountFirstName" name="firstName" type="text" autoComplete="given-name" placeholder="Your first name" required maxLength={80} disabled={pending} />
      <button type="submit" disabled={pending}>{pending ? "Creating…" : "Create account"}</button>
      {state.message ? <p className="auth-message auth-message--error" role="alert">{state.message}</p> : null}
    </form>
  );
}
