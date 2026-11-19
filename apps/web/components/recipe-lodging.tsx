"use client";

import { useRef, useState } from "react";
import { sleepingLabels, sleepingNeeds, type LodgingRunDetail } from "@commons/contracts";
import { propertyRowsError, cleanPropertyRows, newPropertyRow, rowsFromProperties, stableCommand, type PropertyRow } from "@/lib/recipe-client";
import { RecipePropertiesEditor } from "./recipe-properties-editor";
import { HeadcountBanner, NeedsForm, ParticipantPollPreview, PublishPanel, StaleNotice, needResolutionPayload, needsResolved, type DraftLayout, type PanelProps } from "./recipe-shared";

type Props = PanelProps<LodgingRunDetail>;

export function LodgingDraft({ run, busy, act, call, runBase, layout }: Props & { layout?: DraftLayout }) {
  const [rows, setRows] = useState<PropertyRow[]>(() => run.properties.length ? rowsFromProperties(run.properties) : [newPropertyRow(), newPropertyRow()]), [children, setChildren] = useState(run.askAboutChildren);
  const [title, setTitle] = useState(run.title);
  const [intro, setIntro] = useState(run.intro ?? ""), [contextReviewed, setContextReviewed] = useState(false);
  const saved = title === run.title && intro === (run.intro ?? "") && JSON.stringify(rowsFromProperties(run.properties)) === JSON.stringify(cleanRowsForCompare(rows)) && children === run.askAboutChildren && !run.context?.changed;
  const problem = propertyRowsError(rows), command = useRef<{ key: string; id: string } | null>(null);
  async function save() {
    if (problem) return;
    const input = { expectedDraftVersion: run.draft.version, title, properties: cleanPropertyRows(rows), askAboutChildren: children,
      ...(run.properties.length || intro !== (run.intro ?? "") ? { intro } : {}),
      ...(run.context?.changed && contextReviewed ? { reviewedContextFingerprint: run.context.current.fingerprint } : {}) };
    command.current = stableCommand(command.current, input);
    await act(() => call(`${runBase}/alternatives`, "POST", { commandId: command.current!.id, ...input }), "Saved the introduction and places. Still private to organizers.");
  }
  const build = <>
    <HeadcountBanner run={run} />
    <section className="recipe-section" aria-labelledby="recipe-places"><h2 id="recipe-places">Places to compare</h2>
      <label className="fieldnotes-field"><span>Poll title</span><input value={title} maxLength={120} onChange={event => setTitle(event.target.value)} /></label>
      <label className="fieldnotes-field"><span>Poll introduction</span><textarea rows={3} value={intro} maxLength={500} onChange={event => setIntro(event.target.value)} /></label>
      <p className="recipe-note">Add the places you were given, with their links. Prices here are your own estimates, not quotes, and nothing is checked, held or booked.</p>
      <RecipePropertiesEditor rows={rows} onChange={setRows} disabled={busy} error={problem && !saved && rows.some(row => row.name || row.url) ? problem : null} />
      <label className="recipe-ack"><input type="checkbox" checked={children} disabled={busy} onChange={event => setChildren(event.target.checked)} /><span>Ask whether anyone is traveling with a baby or young child</span><small>Only turn this on if it matters for the places you’re comparing.</small></label>
      {run.context?.changed ? <label className="recipe-ack"><input type="checkbox" checked={contextReviewed} onChange={event => setContextReviewed(event.target.checked)} /><span>I’ve reviewed the updated trip details and the poll introduction.</span></label> : null}
      <div className="poll-action-row"><button type="button" className="cm-action" disabled={busy || saved || Boolean(problem) || Boolean(run.context?.changed && !contextReviewed)} onClick={save}>{saved ? "Saved" : "Save places"}</button></div>
    </section>
    <section className="recipe-section" aria-labelledby="recipe-preview"><h2 id="recipe-preview">What people will see</h2>
      <ParticipantPollPreview run={run} />
    </section>
  </>;
  const share = <PublishPanel run={run} busy={busy} act={act} call={call} runBase={runBase} ready={saved && !problem} blockedReason={run.context?.changed ? "Review the updated trip details in Build, then save the places before sharing." : "Save your changes before sharing."} />;
  return layout ? layout(build, share) : <>{build}{share}</>;
}
function cleanRowsForCompare(rows: PropertyRow[]) { return rowsFromProperties(cleanPropertyRows(rows)); }

export function LodgingSummaryView({ run }: { run: LodgingRunDetail }) {
  const summary = run.summary!, link = run.poll?.audienceKind === "link";
  return <section className="recipe-section" aria-labelledby="recipe-fit"><h2 id="recipe-fit">What works</h2>
    <HeadcountBanner run={run} />
    <p role="status" className="recipe-count">{link ? `${summary.respondedCount} answered. We can’t say who is still to answer.` : `${summary.respondedCount} of ${summary.askedCount} answered.${summary.awaiting.length ? ` Still to answer: ${summary.awaiting.join(", ")}.` : ""}`}</p>
    <ul className="recipe-options">{summary.rows.map(row => <li key={row.property.id}>
      <strong>{row.property.name}</strong>
      <p className="recipe-fact">{summary.respondedCount === 0 ? "No answers yet" : `${row.acceptedBy.length} of ${summary.respondedCount} could stay here`}</p>
      <p>{row.property.rooms} · {row.property.beds === "king_only" ? "King beds only" : row.property.beds === "separate_beds_available" ? "Separate beds available" : "Bed setup not listed"}</p>
      <p>{row.pricing}</p>
      {row.acceptedBy.length ? <p>Could stay: {row.acceptedBy.join(", ")}</p> : null}
      {row.preferredBy.length ? <p>Prefer it: {row.preferredBy.join(", ")}</p> : null}
      {row.conflicts.map(conflict => <p className="recipe-attention" key={conflict}>{conflict}</p>)}</li>)}</ul>
    <h3>How people want to sleep</h3>
    <ul className="recipe-history">{sleepingNeeds.map(need => <li key={need}>{sleepingLabels[need]}: {summary.sleeping[need].length ? summary.sleeping[need].join(", ") : "no one"}</li>)}</ul>
    {run.askAboutChildren ? <p className="recipe-note">Traveling with a baby or young child: {summary.childrenYes.length ? summary.childrenYes.join(", ") : "no one said yes"}.</p> : null}
    {summary.neitherBy.length ? <p className="recipe-fact">None of these work for {summary.neitherBy.join(", ")}.</p> : null}
  </section>;
}

export function LodgingDecide({ run, busy, act, call, runBase }: Props) {
  const poll = run.poll!, summary = run.summary!;
  const [choice, setChoice] = useState(""), [exceptions, setExceptions] = useState(""), [ack, setAck] = useState(false), [conflictAck, setConflictAck] = useState(false), [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [carriedReviewed, setCarriedReviewed] = useState(false);
  const hasCarriedNeeds = Boolean(run.context?.saved?.sources.some(source => source.needs.length || source.conditions.length || source.stale.length));
  const command = useRef<{ key: string; id: string } | null>(null);
  const row = summary.rows.find(item => item.property.id === choice) ?? null;
  const participantSummary = row ? `Chose ${row.property.name} as the group’s preferred place to stay. This is a preference, not a booking. Confirm sleeping setup, final price and availability before booking.` : "";
  const lines = exceptions.split("\n").map(line => line.trim()).filter(Boolean);
  const ready = Boolean(row) && ack && (!row?.conflicts.length || conflictAck) && needsResolved(run, resolutions) && Boolean(run.evidenceFingerprint) && lines.length <= 10 && !run.context?.changed && (!hasCarriedNeeds || carriedReviewed);
  async function approve() {
    const body = { pollId: poll.id, evidenceFingerprint: run.evidenceFingerprint, optionId: choice, exceptions: lines, acknowledgedConflicts: row!.conflicts, uncertaintyAcknowledged: true, needResolutions: needResolutionPayload(run, resolutions), participantSummary,
      ...(run.context?.saved ? { contextFingerprint: run.context.current.fingerprint } : {}) };
    command.current = stableCommand(command.current, body);
    await act(() => call(`${runBase}/outcome`, "POST", { ...body, commandId: command.current!.id }), "Preference recorded. Nothing was booked.");
  }
  return <section className="recipe-section" aria-labelledby="recipe-decide"><h2 id="recipe-decide">Choose a place</h2>
    <p className="recipe-note">Voting is closed with {summary.respondedCount} {summary.respondedCount === 1 ? "answer" : "answers"}{summary.awaiting.length ? `. ${summary.awaiting.length} haven’t answered: ${summary.awaiting.join(", ")}` : ""}. This records the place the group prefers. It isn’t a booking, a hold or a payment.</p>
    <fieldset className="recipe-choice"><legend className="recipe-visually-hidden">Choose a place</legend>{summary.rows.map(item => <label key={item.property.id}><input type="radio" name="place" checked={choice === item.property.id} onChange={() => { setChoice(item.property.id); setConflictAck(false); }} />
      <span>{item.property.name}</span><small>{item.acceptedBy.length} could stay · {item.preferredBy.length} prefer it{item.conflicts.length ? ` · ${item.conflicts.length === 1 ? "A bed conflict" : "Bed conflicts"} to review` : ""}</small></label>)}</fieldset>
    {row?.conflicts.length ? <div className="recipe-attention" role="group" aria-label="Conflicts to review"><strong>Review before choosing {row.property.name}</strong><ul>{row.conflicts.map(conflict => <li key={conflict}>{conflict}</li>)}</ul>
      <label className="recipe-ack"><input type="checkbox" checked={conflictAck} onChange={event => setConflictAck(event.target.checked)} /><span className="recipe-ack__text">I’ve reviewed these, and I’m choosing this place anyway.</span></label></div> : null}
    <NeedsForm run={run} resolutions={resolutions} onChange={setResolutions} />
    {hasCarriedNeeds ? <label className="recipe-ack"><input type="checkbox" checked={carriedReviewed} onChange={event => setCarriedReviewed(event.target.checked)} /><span>I’ve reviewed the needs and conditions carried forward from earlier decisions.</span></label> : null}
    <label className="fieldnotes-field"><span>Exceptions or conditions (optional, one per line)</span><textarea rows={3} value={exceptions} onChange={event => setExceptions(event.target.value)} placeholder="For example, confirm a twin room before booking" /></label>
    {row ? <div className="recipe-preview"><h3>Decision recap · visible to this poll’s audience</h3><p>{participantSummary}</p><p className="recipe-note">Private needs, handling notes and conditions above stay with organizers.</p></div> : null}
    <label className="recipe-ack"><input type="checkbox" checked={ack} onChange={event => setAck(event.target.checked)} /><span className="recipe-ack__text">I understand prices are estimates, availability is unchecked, and people who haven’t answered aren’t counted.</span></label>
    <div className="poll-action-row"><button type="button" className="cm-action cm-action--primary" disabled={busy || !ready} onClick={approve}>Record this preference</button></div>
  </section>;
}

export function LodgingOutcome({ run }: Props) {
  const outcome = run.outcome!, result = outcome.result;
  if (result.kind !== "lodging") return null;
  return <section className="recipe-section" aria-labelledby="recipe-outcome"><h2 id="recipe-outcome">Preferred place recorded</h2>
    <div className="recipe-result"><strong>{result.name}</strong>
      <p className="recipe-fact"><a href={result.url} target="_blank" rel="noreferrer noopener">Open the link you were given</a></p>
      <p>{result.rooms} · {result.beds === "king_only" ? "King beds only" : result.beds === "separate_beds_available" ? "Separate beds available" : "Bed setup not listed"}</p>
      <p>{result.pricing}</p>
      <p className="recipe-fact">{result.acceptedCount} of {result.respondedCount} who answered could stay here. Recorded by {outcome.approvedByName}{result.basedOn.headcountIn !== null ? `, planning for ${result.basedOn.headcountIn} confirmed${result.basedOn.headcountMaybe ? ` and ${result.basedOn.headcountMaybe} maybe` : ""}` : ", with no attendance result to plan against"}.</p>
      {result.conflictsAcknowledged.length ? <ul className="recipe-history">{result.conflictsAcknowledged.map(item => <li key={item}>Reviewed: {item}</li>)}</ul> : null}
      {result.exceptions.length ? <ul className="recipe-history">{result.exceptions.map(item => <li key={item}>{item}</li>)}</ul> : null}</div>
    <StaleNotice outcome={outcome} />
    <p className="recipe-note">This is a preference, not a booking. No stay, room assignment, roommate pairing or payment was created.</p>
  </section>;
}
