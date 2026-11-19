"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CoordinatorRecommendationSchema, CoordinatorThreadSchema, type CoordinatorRecommendation, type CoordinatorThread as Thread, type PollWorkingDraft } from "@commons/contracts";
import { CoordinatorMark } from "@commons/ui";
import { PollWorkspaceHeader } from "./poll-workspace-header";
import { CoordinatorReview } from "./coordinator-review";
import "./coordinator-review.css";

export function CoordinatorThread({ slug, eventName, initialThread, initialRecommendations, initialDraftId, conversationAvailable }: {
  slug: string; eventName: string; initialThread: Thread; initialDraftId?: string;
  initialRecommendations: CoordinatorRecommendation[];
  conversationAvailable: boolean;
}) {
  const router = useRouter();
  const [thread, setThread] = useState(initialThread);
  const [recommendations, setRecommendations] = useState(initialRecommendations);
  const [selected, setSelected] = useState(initialDraftId ?? initialThread.drafts.findLast(draft => !draft.publishedPollId)?.id ?? null);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [draftBlocked, setDraftBlocked] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [revision, setRevision] = useState(0);
  const inFlight = useRef(false);
  const commandId = useRef<string | null>(null);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (prompt.trim() || inFlight.current) event.preventDefault(); };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [prompt]);
  const endpoint = `/api/v1/commons/${slug}/coordinator`;
  const editable = thread.drafts.filter(draft => !draft.publishedPollId);
  const current = editable.find(draft => draft.id === selected) ?? null;
  const saved = useCallback((draft: PollWorkingDraft) => setThread(value => ({ ...value, drafts: value.drafts.map(item => item.id === draft.id ? { ...item, ...draft } : item) })), []);
  async function load() {
    const [response, recommendationResponse] = await Promise.all([fetch(endpoint, { cache: "no-store" }), fetch(`/api/v1/commons/${slug}/recommendations`, { cache: "no-store" })]);
    if (!response.ok || !recommendationResponse.ok) throw new Error("Reload to check the private conversation and saved recommendation.");
    const next = CoordinatorThreadSchema.parse(await response.json());
    setRecommendations(CoordinatorRecommendationSchema.array().parse(await recommendationResponse.json()));
    setThread(next);
    return next;
  }
  async function send() {
    if (inFlight.current || draftBlocked || conflict || !conversationAvailable || !prompt.trim()) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      commandId.current ??= crypto.randomUUID();
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ commandId: commandId.current, version: thread.version, prompt, draftId: current?.id ?? null, draftVersion: current?.version ?? null }) });
      const result = await response.json();
      if (response.status === 409) setConflict(true);
      if (!response.ok) throw new Error(result.error ?? "The reply wasn’t saved. Try again.");
      const next = CoordinatorThreadSchema.parse(result);
      setThread(value => ({ ...next, turns: [...value.turns.filter(turn => !next.turns.some(item => item.id === turn.id)), ...next.turns], hasEarlier: value.hasEarlier }));
      setPrompt(""); commandId.current = null; setRevision(value => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The connection was interrupted. Reload to check the saved conversation."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function earlier() {
    if (inFlight.current || !thread.turns[0]) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const response = await fetch(`${endpoint}?before=${thread.turns[0].sequence}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Earlier conversation couldn’t be loaded. Try again.");
      const next = CoordinatorThreadSchema.parse(await response.json());
      setThread(value => ({ ...value, hasEarlier: next.hasEarlier, turns: [...next.turns, ...value.turns] }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Earlier conversation couldn’t be loaded."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const publishedPollIds = new Set(thread.drafts.flatMap(draft => draft.publishedPollId ? [draft.publishedPollId] : []));
  const timeline = [
    // A published review draft is rendered with its saved message and repeat-share
    // controls below. Avoid replacing it with a bare duplicate poll summary.
    ...thread.polls.filter(poll => !publishedPollIds.has(poll.id)).map(poll => ({ kind: "poll" as const, at: poll.createdAt, id: poll.id, poll })),
    ...thread.drafts.map(draft => ({ kind: "draft" as const, at: draft.createdAt, id: draft.id, draft })),
    ...thread.turns.map(turn => ({ kind: "turn" as const, at: turn.createdAt, id: turn.id, turn })),
    ...thread.drafts.flatMap(draft => (draft.data.review?.messages ?? []).map((entry, index) => ({ kind: "legacy" as const, at: entry.at, id: `${draft.id}:history:${index}`, entry }))),
  ].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  return <main className="coordinator-review">
    <PollWorkspaceHeader eventName={eventName} eventHref={`/c/${slug}`} pollsHref={`/c/${slug}/polls`} busy={busy || draftBlocked} onNavigate={href => { if (!prompt.trim() || window.confirm("Leave without sending your message?")) router.push(href); }} />
    <div className="review-heading"><span className="view-kicker">Private · You and Commons</span><h1>Your trip conversation.</h1><p className="review-caption">One ongoing conversation for {eventName}.</p></div>
    <section className="review-layout" aria-label="Private conversation with Commons">
      <div className="review-opening"><span className="review-coordinator"><CoordinatorMark aria-hidden="true" /> Commons</span>
        <p>{thread.polls.length ? "Your earlier polls are here for context. Their results stay linked to the original polls." : "This is where we’ll work through the trip together."} {editable.length ? "The next draft is ready below. Open it to review or edit before sharing." : "We can keep the conversation going as the next step takes shape."}</p>
      </div>
      {recommendations.map(recommendation => {
        const source = thread.polls.find(poll => poll.id === recommendation.sourcePollId);
        return <article className="recommendation-artifact" key={recommendation.id} aria-label="Prepared recommendation">
          <div className="review-artifact-heading"><span className="view-kicker">Private · Prepared recommendation</span><span className="review-saved">Saved version {recommendation.version}</span></div>
          <h2>Recommended next step</h2><p>{recommendation.recommendation}</p>
          <dl className="recommendation-details"><div><dt>Source evidence</dt><dd>{source ? source.title : "Source poll"}{source ? ` · ${source.responseCount} responses` : ""}</dd></div><div><dt>Freshness</dt><dd>{recommendation.freshness}</dd></div><div><dt>Prepared by</dt><dd>{recommendation.preparedBy}</dd></div></dl>
          {recommendation.evidenceCurrent === false ? <p className="recommendation-stale" role="alert">The linked poll evidence changed after this recommendation was prepared. Review it before making a decision.</p> : null}
          {recommendation.uncertainties.length ? <details><summary>Uncertainties ({recommendation.uncertainties.length})</summary><ul>{recommendation.uncertainties.map(item => <li key={item}>{item}</li>)}</ul></details> : null}
          {recommendation.openQuestions.length ? <details><summary>Open questions ({recommendation.openQuestions.length})</summary><ul>{recommendation.openQuestions.map(item => <li key={item}>{item}</li>)}</ul></details> : null}
          <p><strong>Next action:</strong> {recommendation.nextAction}</p>
          <div className="recommendation-actions"><a href={`/c/${slug}/polls/${recommendation.sourcePollId}`}>Inspect source poll</a><a href={`/c/${slug}/polls/${recommendation.sourcePollId}`}>Review a decision</a></div>
          <p className="review-caption">This is prepared advice, not a group decision, booking, or change to the trip plan.</p>
        </article>;
      })}
      {thread.hasEarlier ? <button className="cm-action" disabled={busy || draftBlocked} onClick={() => void earlier()}>Load earlier conversation</button> : null}
      <div className="review-timeline">{timeline.map(item => item.kind === "poll" ? <article key={item.id} className="review-prior-artifact">
        <span className="view-kicker">{thread.drafts.some(draft => draft.publishedPollId === item.poll.id) ? "Published poll" : "Earlier poll · Trip context"}</span><h2>{item.poll.title}</h2><p className="review-caption">{item.poll.responseCount} responses · {item.poll.status === "open" ? "Voting open" : "Voting closed"}</p>
        {item.poll.resultsVisible && item.poll.responseCount ? <div className="review-poll-results" aria-label={`Results for ${item.poll.title}`}>{item.poll.results.map(result => <section key={result.questionId}>
          <h3>{result.prompt}</h3>{result.options.length ? <ul>{result.options.map(option => <li key={option.optionId}><span>{option.label}</span><strong>{option.count}</strong></li>)}</ul> : <p className="review-caption">{result.textResponseCount} written {result.textResponseCount === 1 ? "response" : "responses"}</p>}
        </section>)}</div> : !item.poll.resultsVisible ? <p className="review-caption">Results are available when voting closes.</p> : null}
        <a href={`/c/${slug}/polls/${item.poll.id}`}>View full results and delivery</a>
      </article> : item.kind === "draft" ? <div key={`${item.id}:${revision}`} id={`draft-${item.id}`}>
        {item.draft.publishedPollId ? <CoordinatorReview slug={slug} initialDraft={item.draft} isPublishedArtifact publishedPublicId={thread.polls.find(poll => poll.id === item.draft.publishedPollId)?.publicId} publishedAudienceRestricted={thread.polls.find(poll => poll.id === item.draft.publishedPollId)?.audienceRestricted} onSaved={saved} onBlocked={setDraftBlocked} onPublished={async () => { await load(); setSelected(null); }} /> : current?.id === item.id ? <fieldset className="review-artifact-boundary" disabled={busy}><CoordinatorReview slug={slug} initialDraft={item.draft} onSaved={saved} onBlocked={setDraftBlocked} onPublished={async () => { await load(); setSelected(null); }} /></fieldset> : <article className="review-prior-artifact"><span className="view-kicker">Private draft · Not sent</span><h2>{item.draft.data.title}</h2><button className="cm-action" disabled={busy || draftBlocked} onClick={() => { setSelected(item.id); commandId.current = null; }}>Work on this draft</button></article>}
      </div> : item.kind === "legacy" ? <div key={item.id} className={`review-turn review-chat-${item.entry.role}`}><strong>{item.entry.role === "user" ? "You" : "Commons"}</strong><p>{item.entry.text}</p></div> : <div key={item.id} className="review-turn"><div className="review-chat-user"><strong>You</strong><p>{item.turn.userText}</p></div><div className="review-chat-assistant"><span className="review-coordinator"><CoordinatorMark aria-hidden="true" /> Commons</span><p>{item.turn.assistantText}</p>{item.turn.draftId && editable.some(draft => draft.id === item.turn.draftId) ? <button className="cm-action" disabled={busy || draftBlocked} onClick={() => { setSelected(item.turn.draftId); document.getElementById(`draft-${item.turn.draftId}`)?.scrollIntoView({ block: "start" }); }}>View current draft</button> : null}</div></div>)}</div>
      {error ? <div className="review-error" role="alert"><p>{error}</p>{conflict ? <button className="cm-action" onClick={() => window.location.reload()}>Reload conversation</button> : null}</div> : null}
      <form className="review-composer" onSubmit={event => { event.preventDefault(); void send(); }}>
        {editable.length ? <label>Working on<select value={current?.id ?? ""} disabled={busy || draftBlocked || conflict} onChange={event => { setSelected(event.target.value || null); commandId.current = null; }}><option value="">The trip · no draft edits</option>{editable.map(draft => <option value={draft.id} key={draft.id}>{draft.data.title}</option>)}</select></label> : null}
        <label htmlFor="review-request">Talk it through with Commons</label><textarea id="review-request" aria-describedby="review-connection-status" placeholder={conversationAvailable ? "What should we work through next?" : "Conversation isn’t connected yet"} value={prompt} onChange={event => { setPrompt(event.target.value); commandId.current = null; }} rows={3} maxLength={2000} disabled={busy || !conversationAvailable || conflict} />
        <div className="review-composer-footer"><span className="review-caption" id="review-connection-status">{!conversationAvailable ? editable.length ? "For now, you can review and edit the draft directly." : "Your polls and results are available above." : "Only you and Commons see this conversation."}</span><button className="cm-action cm-action--primary" disabled={!conversationAvailable || busy || draftBlocked || conflict || !prompt.trim()}>{busy ? "Commons is working…" : "Ask Commons"}</button></div>
        {draftBlocked ? <p className="review-caption">Finish or save your draft edits before continuing the conversation.</p> : null}
      </form>
      <p className="review-caption">Nothing goes to the group without your approval. Commons can’t verify live prices or make bookings here.</p>
    </section>
  </main>;
}
