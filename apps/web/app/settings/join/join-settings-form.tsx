"use client";

import { useState, type FormEvent } from "react";

type Mode = "invited" | "domains" | "anyone";

const CHOICES: Array<{ mode: Mode; label: string; detail: string }> = [
  { mode: "invited", label: "Invited people only", detail: "People join when someone invites them to a trip." },
  { mode: "domains", label: "People at these email domains", detail: "Anyone with an email at a domain you list, plus invited people." },
  { mode: "anyone", label: "Anyone with the link", detail: "Anyone who finds this site can create an account." },
];

export function JoinSettingsForm({ initialMode, initialDomains }: { initialMode: Mode; initialDomains: string[] }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [domains, setDomains] = useState(initialDomains.join(", "));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true); setMessage("");
    try {
      const response = await fetch("/api/v1/instance/signup", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ signupMode: mode, allowedDomains: domains }) });
      const payload = await response.json().catch(() => ({})) as { error?: string; signupMode?: Mode; allowedDomains?: string[] };
      if (!response.ok) throw new Error(payload.error ?? "Not saved. Try again.");
      setDomains((payload.allowedDomains ?? []).join(", "));
      setMessage("Saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Not saved. Try again.");
    } finally { setPending(false); }
  }

  return (
    <form className="profile-notifications join-settings" onSubmit={save} aria-labelledby="join-settings-heading">
      <h2 id="join-settings-heading">New accounts</h2>
      <fieldset>
        <legend className="sr-only">Who can create an account</legend>
        {CHOICES.map(choice => (
          <div className="profile-notification-row" key={choice.mode}>
            <span><label htmlFor={`signup-${choice.mode}`}><strong>{choice.label}</strong></label><small>{choice.detail}</small></span>
            <input type="radio" id={`signup-${choice.mode}`} name="signupMode" value={choice.mode} checked={mode === choice.mode} onChange={() => setMode(choice.mode)} />
          </div>
        ))}
      </fieldset>
      {mode === "domains" ? (
        <label className="field field--wide" htmlFor="signup-domains">
          <span>Email domains</span>
          <input id="signup-domains" value={domains} onChange={event => setDomains(event.target.value)} placeholder="example.com, family.net" autoComplete="off" spellCheck={false} />
        </label>
      ) : null}
      <button className="cm-action cm-action--primary" type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
      <small role="status" aria-live="polite">{message}</small>
    </form>
  );
}
