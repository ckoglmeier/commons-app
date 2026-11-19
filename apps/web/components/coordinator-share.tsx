"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CreatePollRequestSchema, type PollWorkingDraft } from "@commons/contracts";
import { copyPublishedMessage, publishedPollMessage, publishedPollSms, publishedPollUrl } from "@/lib/coordinator-sharing";

export function CoordinatorShare({ slug, draft, publicId, audienceRestricted = true, disabled, onPublished, detailsOpen, onToggleDetails }: {
  slug: string; draft: PollWorkingDraft; publicId?: string;
  disabled: boolean; onPublished: (pollId?: string) => Promise<void>;
  detailsOpen?: boolean; onToggleDetails?: () => void;
  audienceRestricted?: boolean;
}) {
  const router = useRouter();
  const [published, setPublished] = useState<{ id: string; publicId: string } | null>(draft.publishedPollId && publicId ? { id: draft.publishedPollId, publicId } : null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [confirmReopen, setConfirmReopen] = useState(false);
  const [manualCopy, setManualCopy] = useState("");
  const [access, setAccess] = useState<"invitees" | "link">("invitees");
  const [restricted, setRestricted] = useState(audienceRestricted);
  const lock = useRef(false), publishCommand = useRef<string | null>(null);
  async function request(url: string, body: unknown) {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "That action couldn’t be completed. Try again.");
    return result;
  }
  async function run(action: () => Promise<void>) {
    if (lock.current || disabled) return;
    lock.current = true; setBusy(true); setError("");
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Try again."); }
    finally { lock.current = false; setBusy(false); }
  }
  async function publish() {
    publishCommand.current ??= crypto.randomUUID();
    const body = CreatePollRequestSchema.parse({ ...draft.data, audience: undefined, commandId: publishCommand.current, draftId: draft.id, draftVersion: draft.version, publicationApproval: { approved: true, access } });
    const result = await request(`/api/v1/commons/${slug}/polls`, body);
    setPublished({ id: result.poll.id, publicId: result.poll.publicId });
    setRestricted(access === "invitees");
    setNotice("Published. No email was sent.");
    await onPublished(result.poll.id);
  }
  async function copy(kind: "email" | "sms" | "link") {
    if (!published) return;
    const url = publishedPollUrl(window.location.origin, published.publicId);
    const text = kind === "email" ? publishedPollMessage(draft.data, url) : kind === "sms" ? publishedPollSms(draft.data, url) : url;
    if (kind === "email") {
      const result = await copyPublishedMessage(draft.data, url);
      setManualCopy(result === "manual" ? text : "");
      setNotice(result === "formatted" ? "Copied for email. Paste it into your message." : result === "plain" ? "Copied as plain text, with the poll link." : "Copy the text below manually.");
      return;
    }
    if (kind === "sms") {
      try { await navigator.clipboard.writeText(text); setNotice("Short message copied. Paste it into a text thread."); setManualCopy(""); }
      catch { setManualCopy(text); setNotice("Copy the short message below manually."); }
      return;
    }
    try { await navigator.clipboard.writeText(text); setNotice("Link copied."); setManualCopy(""); }
    catch { setManualCopy(text); setNotice("Copy the text below manually."); }
  }
  async function reopen() {
    const result = await request(`/api/v1/commons/${slug}/reviews/${draft.id}`, { action: "reopen", version: draft.version });
    router.push(`/c/${slug}/coordinator/?draft=${result.draft.id}`);
    router.refresh();
  }
  return <section className={`review-share${published ? " review-share--published" : ""}`} aria-label={published ? "Share this" : "Publish this"}>
    {error ? <p role="alert">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {!published ? draft.publishedPollId ? <p>Reload to open the published version and its sharing options.</p> : <>
      <label className="review-editor">Who can answer?<select value={access} disabled={busy || disabled} onChange={event => { setAccess(event.target.value as "invitees" | "link"); publishCommand.current = null; }}><option value="invitees">Trip invitees · Sign-in required</option><option value="link">Anyone with the link · No sign-in</option></select></label>
      <p>{access === "link" ? "People can enter their name and answer without an account or accepting a trip invitation. Anyone with the link can open the poll and its visible results. This does not grant trip access." : "Current trip invitees can answer after signing in with their invited email."} No email is sent.</p>
      {!draft.data.questions.length ? <p>Add a question with your coordinator before publishing this poll.</p> : null}
      <button className="cm-action cm-action--primary" disabled={busy || disabled || !draft.data.questions.length} onClick={() => void run(publish)}>{busy ? "Publishing…" : "Share with the group"}</button>
    </> : <>
      <div className="review-share-summary"><strong>{draft.data.title}</strong><span className="review-caption">{draft.data.questions.length} {draft.data.questions.length === 1 ? "question" : "questions"} · Live</span></div>
      <p>{restricted ? "Trip invitees can answer after signing in." : "Anyone with the link can answer without signing in. This link does not grant trip access."} Choose how to share it.</p>
      <div className="review-share-choices">
        <button className="cm-action cm-action--primary" disabled={busy || disabled} onClick={() => void copy("email")}><strong>Copy for email</strong><span>Formatted note and poll</span></button>
        <button className="cm-action" disabled={busy || disabled} onClick={() => void copy("sms")}><strong>Copy for text</strong><span>Short note and poll link</span></button>
        <button className="cm-action" disabled={busy || disabled} onClick={() => void copy("link")}><strong>Copy link</strong><span>Share it anywhere</span></button>
      </div>
      {manualCopy ? <label>Copy this<textarea aria-label="Copy this" readOnly value={manualCopy} rows={5} onFocus={event => event.currentTarget.select()} /></label> : null}
      <div className="review-share-actions">{onToggleDetails ? <button className="cm-action" type="button" aria-expanded={detailsOpen} onClick={onToggleDetails}>{detailsOpen ? "Hide poll and message" : "View poll and message"}</button> : null}<a className="cm-action" href={`/c/poll/${published.publicId}`}>Open poll</a><button className="cm-action" disabled={busy} onClick={() => setConfirmReopen(true)}>{draft.data.lifecycle?.replacementDraftId ? "Open replacement draft" : "Revise poll"}</button></div>
      {confirmReopen ? <section role="alert" className="review-approval"><h3>Re-open this poll?</h3><p>This closes the current version and creates a new draft. Previous responses stay in history but won’t count toward the revised poll. Pending emails will be cancelled. You’ll need to publish and share again.</p><button className="cm-action cm-action--primary" disabled={busy} onClick={() => void run(reopen)}>Re-open for changes</button><button className="cm-action" disabled={busy} onClick={() => setConfirmReopen(false)}>Cancel</button></section> : null}
    </>}
  </section>;
}
