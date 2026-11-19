"use client";

import { feedbackPagePath, type ProductFeedbackAnswers } from "@commons/contracts";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { trackProductEvent } from "@/lib/product-analytics";
import { feedbackScreenshotEmail } from "@/lib/feedback-contact";
import { CloseIcon } from "./icons";
import { ModalLayer } from "./modal-layer";

export function FeedbackSheet({ open, close, commonsSlug = "product", source = "feedback_button", respondentName }: {
  open: boolean;
  close: () => void;
  commonsSlug?: string;
  source?: "walkthrough" | "feedback_button";
  respondentName?: string;
}) {
  const [category, setCategory] = useState<ProductFeedbackAnswers["category"]>("problem");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [feedbackId, setFeedbackId] = useState<string>();
  const [error, setError] = useState("");
  const pending = useRef(false);
  const submission = useRef<{ fingerprint: string; key: string } | null>(null);
  const panel = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!open || !panel.current) return;
    const background = Array.from(document.body.children)
      .filter((element): element is HTMLElement => element instanceof HTMLElement && !element.contains(panel.current))
      .map(element => ({ element, inert: element.inert }));
    background.forEach(({ element }) => { element.inert = true; });
    return () => background.forEach(({ element, inert }) => { element.inert = inert; });
  }, [open]);

  useEffect(() => { if (open && sent) heading.current?.focus(); }, [open, sent]);

  function dismiss() {
    if (sent) {
      setMessage(""); setCategory("problem"); setSent(false); setError("");
      setFeedbackId(undefined);
      submission.current = null;
    }
    close();
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || !message.trim()) return;
    pending.current = true;
    setSending(true); setError("");
    const answers = { category, message: message.trim() };
    const pagePath = feedbackPagePath(window.location.pathname + window.location.search);
    const fingerprint = JSON.stringify({ commonsSlug, source, answers, pagePath });
    if (submission.current?.fingerprint !== fingerprint) submission.current = { fingerprint, key: crypto.randomUUID() };
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch("/api/v1/feedback", {
        method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ commonsSlug, source, questionVersion: 2, respondentName,
          answers, pagePath, idempotencyKey: submission.current.key, website }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || typeof payload?.id !== "string") throw new Error("Feedback not saved.");
      setSent(true);
      setFeedbackId(payload.id);
      trackProductEvent("feedback_submitted", { commonsSlug, properties: { source, category } });
    } catch {
      setError("Feedback not sent. Your message is still here. Try again.");
    } finally {
      window.clearTimeout(timeout); pending.current = false; setSending(false);
    }
  }

  if (!open || typeof document === "undefined") return null;
  const screenshotAction = category === "problem" ? <div className="feedback-sheet__screenshot">
    <a href={feedbackScreenshotEmail({ message, feedbackId, pagePath: window.location.pathname + window.location.search })}>Email a screenshot</a>
    <p>Opens an email to Casey. Attach your screenshot before sending.</p>
  </div> : null;
  return createPortal(
    <ModalLayer close={dismiss}>
      <section ref={panel} className="sheet feedback-sheet" role="dialog" aria-modal="true" aria-labelledby="feedback-title">
        <div className="sheet-handle" />
        <header className="sheet-header">
          <h2 id="feedback-title" ref={heading} tabIndex={-1}>{sent ? "Feedback sent" : "Give feedback"}</h2>
          <button type="button" onClick={dismiss} aria-label="Close feedback"><CloseIcon /></button>
        </header>
        {sent ? <div className="feedback-sheet__success">
          <p role="status">Your message is saved.</p>
          {screenshotAction}
          <button type="button" className="sheet-primary" onClick={dismiss}>Done</button>
        </div> : <form onSubmit={send} className="feedback-sheet__form">
          <fieldset className="feedback-sheet__choices" disabled={sending}>
            <legend className="sr-only">Feedback type</legend>
            <label><input type="radio" name="feedback-type" value="problem" checked={category === "problem"} onChange={() => { setCategory("problem"); setError(""); }} /><span>Report a problem</span></label>
            <label><input type="radio" name="feedback-type" value="suggestion" checked={category === "suggestion"} onChange={() => { setCategory("suggestion"); setError(""); }} /><span>Suggest an improvement</span></label>
          </fieldset>
          <label className="feedback-sheet__message" htmlFor="feedback-message">
            <span>{category === "problem" ? "What happened?" : "What would make Commons better?"}</span>
            <textarea id="feedback-message" value={message} onChange={event => { setMessage(event.target.value); setError(""); }} rows={5} maxLength={2_000} required disabled={sending}
              aria-describedby={`feedback-privacy${error ? " feedback-error" : ""}`}
              placeholder={category === "problem" ? "What were you trying to do? What went wrong?" : "Tell us your idea."} />
          </label>
          {screenshotAction}
          <label className="feedback-sheet__honeypot" aria-hidden="true">Website<input value={website} onChange={event => setWebsite(event.target.value)} tabIndex={-1} autoComplete="off" /></label>
          <p id="feedback-privacy" className="feedback-sheet__privacy">Your {respondentName ? "name, " : ""}message and page address go to Commons, not your group.</p>
          {error ? <p id="feedback-error" className="feedback-sheet__error" role="alert">{error}</p> : null}
          <button type="submit" className="sheet-primary" disabled={sending || !message.trim()} aria-busy={sending}>{sending ? "Sending…" : "Send feedback"}</button>
        </form>}
      </section>
    </ModalLayer>, document.body,
  );
}
