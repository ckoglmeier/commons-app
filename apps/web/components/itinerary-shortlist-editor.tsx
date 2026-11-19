"use client";
import { useState } from "react";
import type { ItineraryContent, ItineraryDraft } from "@commons/contracts";
import {
  decisionScopeFor, participantOptionDetails, shortlistError, shortlistFromChoices, shortlistOptionId, syncDecisionOptions,
  type ShortlistOption,
} from "@commons/contracts";

type Item = ItineraryContent["items"][number];
type Decision = NonNullable<Item["decision"]>;

const MAX_OPTIONS = 8, MAX_LABEL = 160;
const FIT: Record<ShortlistOption["fit"], string> = {
  candidate: "Fits the known rules", requires_confirmation: "Needs confirmation", unsuitable: "Not suitable for this stop",
};

/**
 * Controlled organizer editor over one stop's decision shortlist. It never fetches, saves or
 * publishes: every change is returned through onChange as a complete, valid decision and the
 * parent's autosave persists it. Choosing an option never books, assigns or confirms anything.
 */
export function ItineraryShortlistEditor({ item, evidence, disabled, onChange, results = null, respondents, missing = null }: {
  item: Item; evidence: ItineraryDraft["evidence"]; disabled: boolean; onChange: (decision: Decision) => void;
  /** Display-only reported preferences bound to the published option identity. Never a consensus or a choice. */
  results?: { id?: string; label: string; preferences: number; names: string[] }[] | null; respondents?: number; missing?: number | null;
}) {
  const decision = item.decision as Decision;
  const [message, setMessage] = useState(""), [draftLabel, setDraftLabel] = useState("");
  const shortlist = decision.shortlist ?? null;
  const chosenId = decision.chosenOptionId ?? null;

  /** The only emit path: a decision that fails validation is never sent. */
  function emit(next: ShortlistOption[], chosenOptionId: string | null) {
    const candidate: Decision = { ...decision, shortlist: next, chosenOptionId, options: syncDecisionOptions(next) };
    const problem = shortlistError(candidate);
    if (problem) { setMessage(problem); return false; }
    setMessage(""); onChange(candidate); return true;
  }
  function compare() {
    const built = shortlistFromChoices(item, decision.options, evidence, decisionScopeFor(item)).map(option => option.fit === "unsuitable" ? { ...option, inPoll: false } : option);
    const asked = built.filter(option => option.inPoll).length;
    if (asked < 2) { setMessage("At least two options must be suitable before you can ask the group. Edit the choices and compare again."); return; }
    emit(built, null);
  }
  const update = (id: string, patch: Partial<ShortlistOption>) => shortlist && emit(shortlist.map(option => option.id === id ? { ...option, ...patch } : option), chosenId);
  function add() {
    if (!shortlist) return;
    const label = draftLabel.trim().slice(0, MAX_LABEL);
    if (!label) { setMessage("Enter a name for the option."); return; }
    if (shortlist.length >= MAX_OPTIONS) { setMessage(`A stop can have at most ${MAX_OPTIONS} options.`); return; }
    if (shortlist.some(option => option.label.trim().toLowerCase() === label.toLowerCase())) { setMessage(`"${label}" is already an option.`); return; }
    const id = shortlistOptionId(item.id, label, new Set(shortlist.map(option => option.id)));
    const added: ShortlistOption = { id, label, fit: "requires_confirmation", reasons: [], unknowns: ["Not researched"], sources: [], price: null, location: null, note: "", keep: false, inPoll: false, planItemId: null };
    if (emit([...shortlist, added], chosenId)) setDraftLabel("");
  }
  function remove(option: ShortlistOption) {
    if (!shortlist) return;
    emit(shortlist.filter(row => row.id !== option.id), chosenId);
  }

  const askedCount = shortlist ? shortlist.filter(option => option.inPoll && option.fit !== "unsuitable").length : 0;
  const caption = <>
    <p className="review-caption">Choosing an option prepares it for review. Nothing is booked, assigned or shared until you approve it.</p>
    {results ? <p className="review-caption" role="status">{respondents ?? 0} responded{missing != null ? ` · ${missing} haven't responded` : ""}. Preferences only. Not a decision, booking, or attendance.</p> : null}
  </>;

  if (!shortlist) return <section aria-label={`Options for ${item.title}`}>
    {caption}
    <fieldset disabled={disabled}>
      <legend>{decision.question}</legend>
      <ul className="itinerary-shortlist">{decision.options.map(label => <li key={label} className="itinerary-shortlist-row">{label}</li>)}</ul>
      <div className="workspace-actions"><button type="button" className="cm-action" onClick={compare}>Compare these options</button></div>
      {message ? <p role="alert">{message}</p> : null}
    </fieldset>
  </section>;

  return <section aria-label={`Options for ${item.title}`}>
    {caption}
    <fieldset disabled={disabled}>
      <legend>{decision.question}</legend>
      <p className="review-caption" role="status">{askedCount} of {shortlist.length} options will be asked about. At least two are needed.</p>
      <ul className="itinerary-shortlist">
        {shortlist.map(option => {
          const chosen = option.id === chosenId, unsuitable = option.fit === "unsuitable";
          const onlyAsked = option.inPoll && !unsuitable && askedCount <= 2;
          const removeBlock = chosen ? "The chosen option cannot be removed. Clear the choice first." : option.inPoll && !unsuitable && askedCount <= 2 ? "At least two options must stay in the group question." : "";
          return <li key={option.id} className="itinerary-shortlist-row">
            <p className="itinerary-shortlist-label">{option.label}{chosen ? <span> · Chosen · not booked</span> : null}</p>
            <p className="review-caption">{FIT[option.fit]}{option.location ? ` · ${option.location}` : ""}</p>
            {(() => { const row = results?.find(result => result.id === option.id); return row ? <p>{row.preferences} {row.preferences === 1 ? "preference" : "preferences"}{row.names.length ? `: ${row.names.join(", ")}` : ""}</p> : null; })()}
            {option.reasons.length ? <ul>{option.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul> : null}
            {option.unknowns.length ? <p>Still to confirm: {option.unknowns.join("; ")}</p> : null}
            <p>{participantOptionDetails(option).split(" · ")[0]}</p>
            {option.sources.length ? <p>{option.sources.map(ref => {
              const row = evidence.find(source => source.runId === ref.runId && source.sourceId === ref.sourceId);
              return row ? <span key={`${ref.runId}:${ref.sourceId}`}><a href={row.url} target="_blank" rel="noreferrer">{row.title}</a> ({ref.basis === "primary" ? "supplier page" : "secondary source"}){" "}</span> : null;
            })}</p> : null}
            <label>Private note<textarea aria-label={`Private note for ${option.label}`} maxLength={1000} value={option.note} onChange={event => update(option.id, { note: event.target.value })} /></label>
            <p className="review-caption">Organizers only</p>
            <label className="itinerary-shortlist-check"><input type="checkbox" aria-label={`Keep ${option.label} when refining`} checked={option.keep} onChange={event => update(option.id, { keep: event.target.checked })} />Keep when refining</label>
            <label className="itinerary-shortlist-check"><input type="checkbox" aria-label={`Ask the group about ${option.label}`} checked={option.inPoll && !unsuitable} disabled={unsuitable || onlyAsked} onChange={event => update(option.id, { inPoll: event.target.checked })} />Ask the group</label>
            {onlyAsked ? <p className="review-caption">Two options must stay in the group question.</p> : null}
            <div className="workspace-actions">
              {!unsuitable && !chosen ? <button type="button" className="cm-action" aria-label={`Choose ${option.label}`} onClick={() => emit(shortlist, option.id)}>Choose this option</button> : null}
              {chosen ? <button type="button" className="cm-action" aria-label={`Clear choice of ${option.label}`} onClick={() => emit(shortlist, null)}>Clear choice</button> : null}
              <button type="button" className="cm-action" aria-label={`Remove ${option.label}`} aria-disabled={removeBlock ? true : undefined} onClick={() => { if (removeBlock) setMessage(removeBlock); else remove(option); }}>Remove</button>
            </div>
          </li>;
        })}
      </ul>
      <details>
        <summary className="cm-action">Add an option</summary>
        <label>Option name<input type="text" maxLength={MAX_LABEL} value={draftLabel} onChange={event => setDraftLabel(event.target.value)} /></label>
        <div className="workspace-actions"><button type="button" className="cm-action" onClick={add}>Add option</button></div>
      </details>
      {message ? <p role="alert">{message}</p> : null}
    </fieldset>
  </section>;
}
