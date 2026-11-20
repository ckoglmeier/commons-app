"use client";

import { useState } from "react";

/** One switch: whether Commons emails you when it leaves a new message in your thread. */
export function ProfileMessageEmails({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function update(next: boolean) {
    if (pending) return;
    const previous = enabled;
    setEnabled(next); setPending(true); setMessage("");
    try {
      const response = await fetch("/api/v1/profile", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ dailyDigestEnabled: next }) });
      const payload = await response.json().catch(() => ({})) as { dailyDigestEnabled?: boolean; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Not saved. Try again.");
      setEnabled(payload.dailyDigestEnabled ?? next);
      setMessage(payload.dailyDigestEnabled ?? next ? "Message emails are on." : "Message emails are off.");
    } catch (error) {
      setEnabled(previous);
      setMessage(error instanceof Error ? error.message : "Not saved. Try again.");
    } finally { setPending(false); }
  }

  return (
    <section className="profile-notifications" aria-labelledby="profile-message-emails-heading">
      <span className="view-kicker">Email</span>
      <h2 id="profile-message-emails-heading">New messages</h2>
      <p>When Commons leaves you a message, it sends one short email with a link. No more until you’ve read it.</p>
      <label className="profile-notification-row" htmlFor="message-emails-enabled">
        <strong>Email me about new messages</strong><small>Sign-in, invitation and poll emails don’t change.</small>
        <input type="checkbox" id="message-emails-enabled" role="switch" checked={enabled} disabled={pending} aria-describedby="profile-message-emails-status" onChange={event => void update(event.target.checked)} />
      </label>
      <small id="profile-message-emails-status" role="status" aria-live="polite">{message}</small>
    </section>
  );
}
