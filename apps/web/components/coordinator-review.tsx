"use client";

import { useEffect, useRef, useState } from "react";
import { PollWorkingDraftSchema, pollQuestionFormat, type PollWorkingData, type PollWorkingDraft } from "@commons/contracts";
import { PollCommunication } from "./poll-communication";
import { PollHousingFacts } from "./poll-housing-facts";
import { CoordinatorShare } from "./coordinator-share";

export function CoordinatorReview({ slug, initialDraft, onSaved, onBlocked, onPublished, publishedPublicId, publishedAudienceRestricted, isPublishedArtifact = false, initiallyCollapsed = false, initiallyExpanded = false, inline = false }: {
  slug: string; initialDraft: PollWorkingDraft;
  onSaved: (draft: PollWorkingDraft) => void; onBlocked: (blocked: boolean) => void; onPublished: (pollId?: string) => Promise<void>;
  /** Available only in the authenticated organizer thread after publication. */
  publishedPublicId?: string;
  publishedAudienceRestricted?: boolean;
  isPublishedArtifact?: boolean;
  initiallyCollapsed?: boolean;
  initiallyExpanded?: boolean;
  inline?: boolean;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const [data, setData] = useState(initialDraft.data);
  const [editing, setEditing] = useState(false);
  const [editingMessage, setEditingMessage] = useState(false);
  const [artifactOpen, setArtifactOpen] = useState(!(publishedPublicId || isPublishedArtifact) && (inline || initiallyExpanded || !initiallyCollapsed));
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const inFlight = useRef(false);
  const dirty = JSON.stringify(data) !== JSON.stringify(draft.data);
  const endpoint = `/api/v1/commons/${slug}/reviews/${draft.id}`;
  const isPublished = isPublishedArtifact || Boolean(publishedPublicId) || Boolean(draft.publishedPollId);
  const compactPublished = inline && isPublished;
  useEffect(() => { onBlocked(dirty || Boolean(busy) || editing || editingMessage); return () => onBlocked(false); }, [dirty, busy, editing, editingMessage, onBlocked]);

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (dirty || inFlight.current) { event.preventDefault(); } };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

  function change(next: PollWorkingData) { setData(next); }
  const message = data.communication ?? { heading: data.title || "Group update", paragraphs: [], links: [] };
  function normalizedMessage() {
    const paragraphs = message.paragraphs.map(text => text.trim()).filter(Boolean);
    return paragraphs.length || message.links.length ? { ...message, heading: message.heading.trim() || data.title, paragraphs } : null;
  }
  async function command(action: "save" | "undo" | "save-message") {
    if (inFlight.current || conflict) return;
    inFlight.current = true; setBusy(action); setError("");
    try {
      const cleaned = { ...data, presentationVersion: 2 as const, review: undefined, audience: data.audience ? { ...data.audience, guestEmails: data.audience.guestEmails.map(email => email.trim()).filter(Boolean) } : undefined, communication: normalizedMessage() ?? undefined };
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action === "save-message" ? { action, version: draft.version, communication: normalizedMessage() } : { action, version: draft.version, ...(action === "save" ? { data: cleaned } : {}) }) });
      const result = await response.json();
      if (response.status === 409) setConflict(true);
      if (!response.ok) throw new Error(result.error ?? "That change was not saved.");
      {
        const saved = PollWorkingDraftSchema.parse(result.draft);
        setDraft(saved); setData(saved.data);
        if (action === "save-message") setEditingMessage(false);
        onSaved(saved);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The connection was interrupted. Reload to check the saved draft."); }
    finally { inFlight.current = false; setBusy(""); }
  }

  function editQuestion(index: number, prompt: string) { change({ ...data, questions: data.questions.map((question, i) => i === index ? { ...question, prompt } : question) }); }
  function editOption(questionIndex: number, optionIndex: number, field: "label" | "description" | "url", value: string) {
    change({ ...data, questions: data.questions.map((question, i) => i === questionIndex && question.kind === "choice" ? { ...question, options: question.options.map((option, j) => j === optionIndex ? { ...option, [field]: field === "label" ? value : value || null } : option) } : question) });
  }
  const artifactContentId = `review-artifact-content-${draft.id}`;
  return <>
    {error ? <div className="review-error" role="alert"><p>{error}</p>{conflict ? <button className="cm-action" onClick={() => window.location.reload()}>Reload saved draft</button> : null}</div> : null}
      <article className={`review-artifact${inline ? " review-artifact--inline" : ""}`} aria-label="Poll and message to send">
        {!compactPublished ? <div className="review-artifact-heading"><span className="view-kicker">{isPublished ? "Published poll" : "Poll draft"}</span><span className="review-saved" role="status">{isPublished ? "Published" : busy ? "Working…" : dirty ? "Unsaved edits" : `Saved · Version ${draft.version}`}</span></div> : null}
        {!inline ? <h2>{data.title}</h2> : null}
        {!compactPublished && !artifactOpen ? <><p className="review-artifact-excerpt">{data.intro || "Open the poll to review its introduction and options."}</p><p className="review-caption">{data.questions.length} {data.questions.length === 1 ? "question" : "questions"} · {isPublished ? "Live" : "Not published"}</p></> : null}
        {!compactPublished && (!inline || isPublished) ? <button className="cm-action" aria-expanded={artifactOpen} aria-controls={artifactContentId} disabled={Boolean(busy) || (!isPublished && (dirty || editing))} onClick={() => setArtifactOpen(!artifactOpen)}>{artifactOpen ? (isPublished ? "Hide poll and message" : "Close draft") : (isPublished ? "View poll and message" : "Open message and poll")}</button> : null}
        {artifactOpen ? <div className="review-preview" id={artifactContentId}>
        <div className="review-section-heading">{!inline ? <h3>Poll</h3> : <span className="review-caption">Poll preview</span>}{!isPublished ? <button className="cm-action" disabled={Boolean(busy) || conflict} onClick={() => { if (editing && dirty) { setData(draft.data); } setEditing(!editing); }}>{editing ? (dirty ? "Cancel edits" : "Done editing") : "Edit poll"}</button> : null}</div>
        {editing ? <fieldset className="review-editor" disabled={Boolean(busy) || conflict}><legend>Edit your draft</legend>
          <label>Poll title<input value={data.title} maxLength={120} onChange={event => change({ ...data, title: event.target.value })} /></label>
          <label>Poll introduction <small>This bridges prior decisions to the current question and appears on the poll page.</small><textarea rows={4} maxLength={500} value={data.intro ?? ""} onChange={event => change({ ...data, intro: event.target.value })} /></label>
          <div className="review-editor-divider"><strong>Message to send</strong><small>Optional delivery copy. Changing it does not change the poll.</small></div>
          <label>Email subject<input value={message.heading} maxLength={160} onChange={event => change({ ...data, communication: { ...message, heading: event.target.value } })} /></label>
          <label>Organizer note <small>Keep this personal and brief. Commons adds the poll introduction, options, and link below it.</small><textarea rows={6} value={message.paragraphs.join("\n\n")} onChange={event => change({ ...data, communication: { ...message, paragraphs: event.target.value.split(/\n\n+/) } })} /></label>
          {message.links.map((link, index) => <div key={index} className="review-link-editor"><label>Link label<input value={link.label} maxLength={160} onChange={event => change({ ...data, communication: { ...message, links: message.links.map((item, i) => i === index ? { ...item, label: event.target.value } : item) } })} /></label><label>Website<input type="url" value={link.url} onChange={event => change({ ...data, communication: { ...message, links: message.links.map((item, i) => i === index ? { ...item, url: event.target.value } : item) } })} /></label></div>)}
        </fieldset> : null}
        <section className="review-questions">{!inline ? <h2>{data.title}</h2> : null}{!editing && data.intro ? <p className="review-poll-intro">{data.intro}</p> : null}
          {data.questions.map((question, index) => <div className="review-question" key={question.id}>
            {editing ? <label>Question {index + 1}<input value={question.prompt} maxLength={240} disabled={Boolean(busy)} onChange={event => editQuestion(index, event.target.value)} /></label> : <h3>{question.prompt}</h3>}
            <p className="review-caption">{pollQuestionFormat(question)}{question.required ? "" : " · Optional"}</p>
            {question.kind === "choice" ? question.options.map((option, optionIndex) => <div className="review-option" key={option.id}>
              {editing ? <><label>Option {optionIndex + 1}<input value={option.label} maxLength={160} disabled={Boolean(busy)} onChange={event => editOption(index, optionIndex, "label", event.target.value)} /></label><label>Description<textarea value={option.description ?? ""} maxLength={180} rows={2} disabled={Boolean(busy)} onChange={event => editOption(index, optionIndex, "description", event.target.value)} /></label><label>Website<input type="url" value={option.url ?? ""} disabled={Boolean(busy)} onChange={event => editOption(index, optionIndex, "url", event.target.value)} /></label></> : <><strong>{option.label}</strong>{option.description ? <p>{option.description}</p> : null}{option.url ? <a href={option.url} target="_blank" rel="noreferrer">Hotel website</a> : null}</>}
              {option.housing ? <PollHousingFacts housing={option.housing} compact /> : null}
            </div>) : question.kind !== "text" ? <><p className="review-caption">Edit this answer format through its recipe.</p><ul>{question.options.map(option => <li key={option.id}>{option.label}</li>)}</ul></> : null}
          </div>)}
        </section>
        {!editing ? <section className="review-delivery-note"><div className="review-section-heading"><div><h3>Message to send</h3><span className="review-caption">Optional · Can change without reopening the poll</span></div>{isPublished ? <button className="cm-action" disabled={Boolean(busy) || conflict} onClick={() => { if (editingMessage && dirty) setData(draft.data); setEditingMessage(!editingMessage); }}>{editingMessage ? "Cancel" : "Edit message"}</button> : null}</div>
          {editingMessage ? <fieldset className="review-editor" disabled={Boolean(busy) || conflict}><legend>Edit the delivery message</legend><label>Email subject<input value={message.heading} maxLength={160} onChange={event => change({ ...data, communication: { ...message, heading: event.target.value } })} /></label><label>Organizer note <small>Leave this blank to share only the Commons poll.</small><textarea rows={6} value={message.paragraphs.join("\n\n")} onChange={event => change({ ...data, communication: { ...message, paragraphs: event.target.value.split(/\n\n+/) } })} /></label><button className="cm-action cm-action--primary" disabled={!dirty || Boolean(busy)} onClick={() => void command("save-message")}>Save message</button></fieldset> : data.communication ? <PollCommunication message={message} /> : <p className="review-caption">No organizer note. Shares will use the poll title, introduction, and link.</p>}
          <p className="review-caption">Commons adds the published poll and Vote in Commons link below this note. This note does not appear on the poll page.</p></section> : null}
        {!isPublished && dirty ? <button className="cm-action cm-action--primary" disabled={Boolean(busy) || conflict} onClick={() => void command("save")}>Save edits</button> : null}
        </div> : null}
        <CoordinatorShare slug={slug} draft={draft} publicId={publishedPublicId} audienceRestricted={publishedAudienceRestricted} disabled={Boolean(busy) || dirty || editing || conflict} detailsOpen={artifactOpen} onToggleDetails={compactPublished ? () => setArtifactOpen(!artifactOpen) : undefined} onPublished={async pollId => {
          if (pollId) { setDraft({ ...draft, publishedPollId: pollId }); setArtifactOpen(false); }
          // Refresh/select the saved poll before invalidating its editable draft selection.
          // Otherwise Work can fall back to a different artifact in the same conversation.
          await onPublished(pollId);
          if (pollId) onSaved({ ...draft, publishedPollId: pollId });
        }} />
      </article>
      <div className="review-artifact-notes">
        {data.settledFacts ? <details><summary>What this draft is based on</summary><p className="review-facts">{data.settledFacts}</p></details> : null}
        {!isPublished && draft.data.review?.previous ? <div className="review-change" role="status"><p>{draft.data.review.lastChange}</p><button className="cm-action" disabled={Boolean(busy) || dirty || conflict} onClick={() => void command("undo")}>Undo last edit</button></div> : null}
      </div>
  </>;
}
