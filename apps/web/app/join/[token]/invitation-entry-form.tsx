"use client";

import { useActionState, useState } from "react";
import { SignInForm } from "@/app/sign-in/sign-in-form";
import { continueInvitationEmail, sendInvitationEntryEmail, type InvitationEntryState } from "./actions";

export function InvitationEntryForm({ token, entry, poll, emailLabel, currentAccountId = "", currentEmail, next, enabled }: {
  token: string; entry?: string; poll?: string; emailLabel: string; currentAccountId?: string; currentEmail?: string;
  next: string; enabled: boolean;
}) {
  const [state, action, pending] = useActionState(continueInvitationEmail, {} as InvitationEntryState);
  const [emailState, emailAction, emailPending] = useActionState(sendInvitationEntryEmail, {} as InvitationEntryState);
  const [different, setDifferent] = useState(false);
  const fresh = Boolean(entry && !state.expired);
  return <div className="invitation-entry-form">
    {currentEmail ? <p>Signed in as {currentEmail}. Continuing as {emailLabel} switches accounts.</p> : null}
    {!different ? <>
      <form className="auth-form" action={fresh ? action : emailAction}>
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="poll" value={poll ?? ""} />
        <input type="hidden" name="entry" value={entry ?? ""} />
        <input type="hidden" name="currentAccountId" value={currentAccountId} />
        <button disabled={!enabled || pending || emailPending || emailState.sent} type="submit">
          {pending ? "Signing in…" : emailPending ? "Sending…" : emailState.sent ? "Email sent" : fresh ? `Continue as ${emailLabel}` : "Email me a sign-in link"}
        </button>
        {state.error ? <p className="auth-message auth-message--error" role="alert">{state.error}</p> : null}
        {emailState.error ? <p className="auth-message auth-message--error" role="alert">{emailState.error}</p> : null}
        {emailState.sent ? <p role="status">Check the inbox for {emailLabel}. Your trip will be waiting.</p> : null}
      </form>
    </> : <SignInForm next={next} enabled={enabled} intent="invited" />}
    <button className="invitation-entry-form__alternative" type="button" onClick={() => setDifferent(!different)}>
      {different ? `Use ${emailLabel}` : "Use a different email"}
    </button>
  </div>;
}
