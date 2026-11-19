"use client";

import { CompareStaysReact } from "./compare-stays-option";
import { useEffect, useState } from "react";
import { compareStaysPollPath, recoverStayComparisonDraft, type CompareStaysSnapshot, type StayComparisonDraft, type StayComparisonFocus } from "../lib/compare-stays";


export function CompareStays({ snapshot, actorId, threadId, renderer = "react" }: { renderer?: "react" | "openui"; snapshot: CompareStaysSnapshot; actorId: string; threadId: string }) {
  void renderer; // Kept for saved QA callers; the application now always uses native Commons rendering.
  const storageKey = `commons:${snapshot.tripId}:${actorId}:${threadId}:compare-stays:v1`;
  const [draft, setDraft] = useState<StayComparisonDraft>({ revision: snapshot.revision, selectedIds: [], focus: "overview" });
  const [ready, setReady] = useState(false), [storageError, setStorageError] = useState(false);
  useEffect(() => {
    let raw: string | null = null, failed = false;
    try { raw = sessionStorage.getItem(storageKey); } catch { failed = true; }
    const frame = requestAnimationFrame(() => { setDraft(recoverStayComparisonDraft(raw, snapshot)); setStorageError(failed); setReady(true); });
    return () => cancelAnimationFrame(frame);
    // Refreshing saved facts must mark an existing draft stale, not accept it automatically.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  const update = (next: StayComparisonDraft) => {
    setDraft(next);
    try { sessionStorage.setItem(storageKey, JSON.stringify(next)); setStorageError(false); } catch { setStorageError(true); }
  };
  const stale = draft.revision !== snapshot.revision;
  const pollPath = ready ? compareStaysPollPath(snapshot, draft) : null;
  return <section className="compare-stays" aria-labelledby="compare-stays-title">
    <p className="review-caption">Pilot · Organizers only · Saved stay options</p>
    <h2 id="compare-stays-title">Compare stays</h2>
    <p>Compare the places you’re considering, then review a private poll for the group.</p>
    <p className="review-caption">Shortlist choices stay in this browser session. A shortlist is not a booking or a group decision.</p>
    {snapshot.options.length < 2 ? <p>Add at least two considered stays in <a className="cm-action cm-action--quiet" href={`/c/${encodeURIComponent(snapshot.tripId)}?arrival=0&view=plan&section=stays`}>Plan → Stays</a> to compare.</p> : null}
    {snapshot.options.length > 0 ? <>
      <label className="compare-stays-focus">Focus on<select value={draft.focus} disabled={!ready} onChange={event => update({ ...draft, focus: event.target.value as StayComparisonFocus })}>
        <option value="overview">The whole picture</option><option value="price">Price</option><option value="location">Location</option><option value="notes">Rooms, needs and notes</option>
      </select></label>
      <p className="review-caption">Dates, included people and currencies may differ. Location distances are straight-line, not drive times.</p>
      {stale ? <div className="compare-stays-attention" role="status"><p>Saved stay details changed. Review the current options below before continuing.</p><button className="cm-action" type="button" onClick={() => update({ ...draft, revision: snapshot.revision, selectedIds: draft.selectedIds.filter(id => snapshot.options.some(option => option.id === id)) })}>Use these current options</button></div> : null}
      <CompareStaysReact snapshot={snapshot} selectedIds={draft.selectedIds} disabled={!ready || stale} focus={draft.focus} select={(id, included) => update({ ...draft, selectedIds: included ? [...new Set([...draft.selectedIds, id])] : draft.selectedIds.filter(value => value !== id) })} />
      <footer className="compare-stays-footer">
        <p role="status">{draft.selectedIds.filter(id => snapshot.options.some(option => option.id === id)).length} {draft.selectedIds.length === 1 ? "option" : "options"} shortlisted in this browser session.</p>
        {pollPath ? <a className="cm-action cm-action--primary" href={pollPath} target="_blank" rel="noopener noreferrer">Review a poll with these stays<span className="sr-only"> (opens in a new tab)</span></a> : <p className="review-caption">Choose at least two current options to review a poll.</p>}
        <p className="review-caption">Review the draft and choose who can answer before sharing.</p>
      </footer>
    </> : null}
    {storageError ? <p role="alert">These choices couldn’t be kept in this browser. Keep this view open or choose the options again after reloading.</p> : null}
  </section>;
}
