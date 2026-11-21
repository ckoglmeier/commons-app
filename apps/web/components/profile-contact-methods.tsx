"use client";

import { useState } from "react";
import { personFacingError } from "@/lib/person-facing-error";

export function ProfileContactMethods({ email, passwordSignIn = false }: { email: string | null; passwordSignIn?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [emailValue, setEmailValue] = useState(email ?? "");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function begin() {
    setEditing(true);
    setMessage("");
    setError("");
  }

  async function requestUpdate(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/v1/profile/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "email", value: emailValue }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Contact method not updated.");
      setMessage(payload.requiresCurrentEmailConfirmation
        ? "Check both your current and new email to confirm the change."
        : "Check your email to confirm this address.");
    } catch (updateError) {
      setError(personFacingError(updateError, "Contact method not updated. Try again."));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="profile-contact">
      <h2>Contact methods</h2>
      <div className="profile-contact-row">
        <div><span>Email</span><strong>{email ?? "Not added"}</strong><small>{email ? (passwordSignIn ? "Used for sign-in" : "Verified for sign-in") : "Add an email for sign-in."}</small>{passwordSignIn ? <small>To change it, ask the person who runs this copy of Commons.</small> : null}</div>
        {passwordSignIn ? null : <button type="button" onClick={begin}>{email ? "Edit" : "Add"}</button>}
      </div>
      {editing && !passwordSignIn ? <form className="profile-contact-editor" onSubmit={(event) => void requestUpdate(event)}>
        <label className="field"><span>Email</span><input type="email" value={emailValue} onChange={(event) => setEmailValue(event.target.value)} autoComplete="email" inputMode="email" placeholder="you@example.com" required /></label>
        <div><button type="submit" disabled={pending}>{pending ? "Sending…" : "Send confirmation"}</button><button type="button" onClick={() => setEditing(false)}>Cancel</button></div>
      </form> : null}
      {message ? <p className="profile-contact-message" role="status">{message}</p> : null}
      {error ? <p className="profile-contact-message profile-contact-message--error" role="alert">{error}</p> : null}
    </section>
  );
}
