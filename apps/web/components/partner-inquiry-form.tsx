"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

/**
 * The partner inquiry form: a minimal, reusable component for the marketing pages (DMO contact, travel-assistant partner). It posts to
 * /api/v1/beta/inquiries, which is closed (404) unless the beta rework is on. It claims no partnership, integration or response time.
 *
 * Usage: <PartnerInquiryForm kind="dmo" sourcePath="/destinations/contact" />
 */
export function PartnerInquiryForm({ kind, sourcePath = "/", endpoint = "/api/v1/beta/inquiries" }: { kind: "dmo" | "travel_assistant"; sourcePath?: string; endpoint?: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const opened = useRef(0);
  // Time since the form appeared lets the server treat an instant submission as automated. Set after mount, never during render.
  useEffect(() => { opened.current = Date.now(); }, []);
  const heading = useRef<HTMLParagraphElement>(null);
  const org = kind === "dmo" ? "Organization" : "Company or assistant name";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "sending") return;
    const form = new FormData(event.currentTarget);
    setState("sending"); setError("");
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind, sourcePath, idempotencyKey: key, elapsedMs: Date.now() - opened.current,
          organization: form.get("organization"), contactName: form.get("contactName"), contactEmail: form.get("contactEmail"),
          website: form.get("website") || undefined, region: form.get("region") || undefined, message: form.get("message"), fax: form.get("fax") || undefined,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Inquiry not sent. Your message is still here. Try again.");
      setState("sent"); setKey(crypto.randomUUID());
      requestAnimationFrame(() => heading.current?.focus());
    } catch (cause) {
      setState("idle");
      setError(cause instanceof Error ? cause.message : "Inquiry not sent. Your message is still here. Try again.");
    }
  }

  if (state === "sent") return <div className="partner-inquiry partner-inquiry--sent" role="status">
    <p ref={heading} tabIndex={-1}><strong>Inquiry received.</strong></p>
    <p>Add anything else by replying from the email address you gave.</p>
  </div>;

  return <form className="partner-inquiry" onSubmit={submit} noValidate={false}>
    <label>{org}<input name="organization" required maxLength={160} autoComplete="organization" /></label>
    <label>Your name<input name="contactName" required maxLength={120} autoComplete="name" /></label>
    <label>Email<input name="contactEmail" type="email" required maxLength={254} autoComplete="email" inputMode="email" /></label>
    <label>Website · optional<input name="website" type="url" maxLength={200} autoComplete="url" placeholder="https://" /></label>
    <label>{kind === "dmo" ? "Destination or region" : "Where you work"} · optional<input name="region" maxLength={120} /></label>
    <label>What would you like to talk about?<textarea name="message" required minLength={10} maxLength={2000} rows={5} /></label>
    <label className="partner-inquiry__hp" aria-hidden="true">Leave this empty<input name="fax" tabIndex={-1} autoComplete="off" /></label>
    <p className="partner-inquiry__note">Your details go to the Commons team. They aren’t shared with travelers or added to any trip.</p>
    {error ? <p className="partner-inquiry__error" role="alert">{error}</p> : null}
    <button type="submit" className="cm-action cm-action--primary" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Send inquiry"}</button>
  </form>;
}
