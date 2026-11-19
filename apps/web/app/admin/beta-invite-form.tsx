"use client";

import { useActionState, useState } from "react";
import { inviteBetaOrganizer } from "./actions";

export function BetaInviteForm({ enabled }: { enabled: boolean }) {
  const [state, action, pending] = useActionState(inviteBetaOrganizer, { message: "", error: false });
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  return <form className="operator-search" action={action}>
    <label htmlFor="beta-invite-email">Email address</label>
    <div><input id="beta-invite-email" name="email" type="email" autoComplete="email" maxLength={254} required aria-describedby="beta-invite-scope" readOnly={pending} value={email} onChange={event => setEmail(event.target.value)} /></div>
    <label htmlFor="beta-invite-message">Personal message · Optional</label>
    <textarea id="beta-invite-message" name="message" rows={4} maxLength={2000} readOnly={pending} aria-describedby="beta-message-help" value={message} onChange={event => setMessage(event.target.value)} />
    <p id="beta-message-help">Included in the invitation email. Up to 2,000 characters.</p>
    <p id="beta-invite-scope">They can create events after signing in with this email. This doesn’t add them to a trip or give them admin access.</p>
    <button type="submit" disabled={pending || !enabled}>{pending ? "Sending…" : "Send invite"}</button>
    {state.message ? <p role={state.error ? "alert" : "status"}>{state.message}</p> : null}
  </form>;
}
