"use client";

import { useEffect, useRef, useState } from "react";
import { formatAlternativeLabel, type DatesLocationRunDetail } from "@commons/contracts";
import { alternativeRowsError, cleanAlternativeRows, formatRange, newAlternativeRow, rowsFromAlternatives, stableCommand, type AlternativeRow } from "@/lib/recipe-client";
import { RecipeAlternativesEditor } from "./recipe-alternatives-editor";
import { RecipeConvergenceEditor } from "./recipe-convergence-editor";
import { PollResults } from "./poll-results";
import { NeedsForm, PublishPanel, StaleNotice, needResolutionPayload, needsResolved, type DraftLayout, type PanelProps } from "./recipe-shared";

type Props = PanelProps<DatesLocationRunDetail>;

type DraftProps = Props & { onDirtyChange?: (dirty: boolean) => void; layout?: DraftLayout };
export function DatesLocationDraft({ run, busy, act, call, runBase, onDirtyChange, layout }: DraftProps) {
  const [flexible, setFlexible] = useState(Boolean(run.configuration) || !run.alternatives.length);
  if (flexible) return <RecipeConvergenceEditor run={run} busy={busy} act={act} call={call} runBase={runBase} onDirtyChange={onDirtyChange} layout={layout} />;
  const choose = <button type="button" className="cm-action" disabled={busy} onClick={() => setFlexible(true)}>Choose questions for this round</button>;
  return <LegacyDatesLocationDraft run={run} busy={busy} act={act} call={call} runBase={runBase} onDirtyChange={onDirtyChange} layout={(build, share) => layout ? layout(<>{choose}{build}</>, share) : <>{choose}{build}{share}</>} />;
}
function LegacyDatesLocationDraft({ run, busy, act, call, runBase, onDirtyChange, layout }: DraftProps) {
  const [rows, setRows] = useState<AlternativeRow[]>(() => run.alternatives.length ? rowsFromAlternatives(run.alternatives) : [newAlternativeRow(), newAlternativeRow()]);
  const [title, setTitle] = useState(run.title);
  const saved = title === run.title && JSON.stringify(rowsFromAlternatives(run.alternatives)) === JSON.stringify(rows.map(row => ({ ...row, place: row.place.trim() })));
  useEffect(() => { onDirtyChange?.(!saved); }, [saved, onDirtyChange]);
  const problem = alternativeRowsError(rows), command = useRef<{ key: string; id: string } | null>(null);
  async function save() {
    if (problem) return;
    command.current = stableCommand(command.current, { rows, title, version: run.draft.version });
    await act(() => call(`${runBase}/alternatives`, "POST", { commandId: command.current!.id, expectedDraftVersion: run.draft.version, title, alternatives: cleanAlternativeRows(rows) }), "Saved. Still private to organizers.");
  }
  const build = <>
    <section className="recipe-section" aria-labelledby="recipe-options"><h2 id="recipe-options">Options</h2>
      <label className="fieldnotes-field"><span>Poll title</span><input disabled={busy} value={title} maxLength={120} onChange={event => setTitle(event.target.value)} /></label>
      <p className="recipe-note">Each option is one set of dates in one place. This draft is private to trip organizers.</p>
      <RecipeAlternativesEditor rows={rows} onChange={setRows} disabled={busy} error={problem && !saved && rows.some(row => row.place || row.startsOn || row.endsOn) ? problem : null} />
      <div className="poll-action-row"><button type="button" className="cm-action" disabled={busy || saved || Boolean(problem)} onClick={save}>{saved ? "Saved" : "Save options"}</button></div>
    </section>
    <section className="recipe-section" aria-labelledby="recipe-preview"><h2 id="recipe-preview">What people will see</h2>
      <p className="recipe-note">Two questions, answered on the poll page. Nobody is asked to vote on dates and places separately.</p>
      <div className="recipe-preview"><strong>Which of these could you do?</strong><ul>{run.alternatives.map(item => <li key={item.id}>{formatAlternativeLabel(item)}</li>)}<li>None of these work for me <small>(can’t be combined with the others)</small></li></ul>
        <strong>If you could only pick one, which would you prefer?</strong><p className="recipe-note">Optional. Same options.</p></div>
    </section>
  </>;
  const share = <PublishPanel run={run} busy={busy} act={act} call={call} runBase={runBase} ready={saved && !problem} blockedReason="Save your changes before sharing." />;
  return layout ? layout(build, share) : <>{build}{share}</>;
}

export function DatesLocationOverlap({ run }: { run: DatesLocationRunDetail }) {
  const summary = run.summary!, linkPoll = run.poll?.audienceKind === "link";
  const unresolvedNeeds = (run.advice?.constraints.length ?? 0) > 0 || summary.needsNoted > 0;
  return <section className="recipe-section" aria-labelledby="recipe-overlap"><h2 id="recipe-overlap">What works</h2>
    <p role="status" className="recipe-count">{linkPoll ? `${summary.respondedCount} ${summary.respondedCount === 1 ? "person has" : "people have"} answered. This poll is open to anyone with the link, so we can’t say who is still to answer.`
      : `${summary.respondedCount} of ${summary.askedCount} ${summary.askedCount === 1 ? "person has" : "people have"} answered.${summary.awaiting.length ? ` Still to answer: ${summary.awaiting.join(", ")}.` : ""}`}</p>
    <p className="recipe-note">Counts describe this round’s answers and audience. Silence isn’t a yes, and matching answers aren’t agreement.{unresolvedNeeds ? " Stated needs still require organizer review before choosing an outcome." : ""}</p>
    <ul className="recipe-options">{summary.rows.map(row => <li key={row.alternative.id} data-works={row.worksForAllWhoAnswered || undefined}>
      <strong>{row.label}</strong>
      <p className="recipe-fact">{summary.respondedCount === 0 ? "No answers yet" : row.worksForAllWhoAnswered ? "Selected as workable by everyone who answered" : `Selected as workable by ${row.acceptedBy.length} of ${summary.respondedCount} who answered`}{unresolvedNeeds && summary.respondedCount > 0 ? " · Needs still require review" : ""}</p>
      {row.acceptedBy.length ? <p>Could do it: {row.acceptedBy.join(", ")}</p> : null}
      {row.preferredBy.length ? <p>Prefer it: {row.preferredBy.join(", ")}</p> : null}
      {row.notAcceptedBy.length ? <p>Didn’t choose it: {row.notAcceptedBy.join(", ")}</p> : null}</li>)}</ul>
    {summary.neitherCount ? <p className="recipe-fact">None of these work for {summary.neitherBy.join(", ")}.</p> : null}
    {run.ballotResults?.questions.some(question => question.kind !== "choice" && question.kind !== "text") ? <PollResults poll={{ ...run.ballotResults, questions: run.ballotResults.questions.filter(question => question.kind !== "choice" && question.kind !== "text") }} /> : null}
  </section>;
}

export function DatesLocationExploration({ run }: { run: DatesLocationRunDetail }) {
  return <section className="recipe-section"><h2>Exploratory round</h2><p>These answers help narrow the next question. They don’t show a date-and-place fit or support updating the trip. Start another round in this Goal for a focused follow-up.</p>{run.ballotResults ? <PollResults poll={run.ballotResults} /> : null}</section>;
}

export function DatesLocationDecide({ run, busy, act, call, runBase }: Props) {
  if (run.exploratory || !run.summary) return <DatesLocationExploration run={run} />;
  return <DatesLocationDecideBody run={run} busy={busy} act={act} call={call} runBase={runBase} />;
}
function DatesLocationDecideBody({ run, busy, act, call, runBase }: Props) {
  const poll = run.poll!, summary = run.summary!;
  const [choice, setChoice] = useState(""), [exceptions, setExceptions] = useState(""), [ack, setAck] = useState(false), [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [priorResolutions, setPriorResolutions] = useState<Record<string, string>>({});
  const priorNeeds = (run.advice?.constraints ?? []).filter(need => need.source.pollId !== poll.id);
  const priorKey = (need: typeof priorNeeds[number]) => `${need.source.pollId}:${need.source.responseId}:${need.source.questionId}`;
  const command = useRef<{ key: string; id: string } | null>(null);
  const lines = exceptions.split("\n").map(line => line.trim()).filter(Boolean);
  const ready = Boolean(choice) && ack && needsResolved(run, resolutions) && priorNeeds.every(need => priorResolutions[priorKey(need)]?.trim()) && Boolean(run.evidenceFingerprint) && lines.length <= 10;
  async function approve() {
    const body = { pollId: poll.id, evidenceFingerprint: run.evidenceFingerprint, connectedEvidenceFingerprint: run.connectedEvidence?.fingerprint,
      priorNeedResolutions: priorNeeds.map(need => ({ pollId: need.source.pollId, responseId: need.source.responseId, questionId: need.source.questionId, resolution: priorResolutions[priorKey(need)].trim() })),
      alternativeId: choice, exceptions: lines, uncertaintyAcknowledged: true, needResolutions: needResolutionPayload(run, resolutions) };
    command.current = stableCommand(command.current, body);
    await act(() => call(`${runBase}/outcome`, "POST", { ...body, commandId: command.current!.id }), "Result approved. The trip hasn’t changed yet.");
  }
  return <section className="recipe-section" aria-labelledby="recipe-decide"><h2 id="recipe-decide">Decide</h2>
    <p className="recipe-note">Voting is closed with {summary.respondedCount} {summary.respondedCount === 1 ? "answer" : "answers"}{summary.awaiting.length ? `. ${summary.awaiting.length} haven’t answered: ${summary.awaiting.join(", ")}` : ""}. Choose what the group is going with. This is your decision, not a count.</p>
    <fieldset className="recipe-choice"><legend className="recipe-visually-hidden">Choose the result</legend>{summary.rows.map(row => <label key={row.alternative.id}><input type="radio" name="result" checked={choice === row.alternative.id} onChange={() => { setChoice(row.alternative.id); setResolutions({}); setPriorResolutions({}); setAck(false); }} />
      <span>{row.label}</span><small>{row.acceptedBy.length} could do it · {row.preferredBy.length} prefer it{row.notAcceptedBy.length ? ` · Didn’t choose it: ${row.notAcceptedBy.join(", ")}` : ""}</small></label>)}</fieldset>
    <NeedsForm run={run} resolutions={resolutions} onChange={setResolutions} />
    {priorNeeds.length ? <div className="recipe-needs"><h3>Needs from earlier rounds</h3><p className="recipe-note">Say how each earlier need is handled for this date and place. Only organizers see this.</p>{priorNeeds.map(need => <label className="fieldnotes-field" key={priorKey(need)}><span>{need.name}: {need.text}</span><input type="text" maxLength={500} value={priorResolutions[priorKey(need)] ?? ""} placeholder="How will this selected option meet the need?" disabled={!choice} onChange={event => setPriorResolutions({ ...priorResolutions, [priorKey(need)]: event.target.value })} required /></label>)}</div> : null}
    <label className="fieldnotes-field"><span>Exceptions or conditions (optional, one per line)</span><textarea rows={3} value={exceptions} onChange={event => setExceptions(event.target.value)} placeholder="For example, Cy hasn’t answered yet" /></label>
    <label className="recipe-ack"><input type="checkbox" checked={ack} onChange={event => setAck(event.target.checked)} /><span className="recipe-ack__text">I understand these answers show who could make it, not who has committed. People who haven’t answered aren’t counted.</span></label>
    <div className="poll-action-row"><button type="button" className="cm-action cm-action--primary" disabled={busy || !ready} onClick={approve}>Approve this result</button></div>
    <p className="recipe-note">Approving records the decision and who made it. It doesn’t change the trip dates or location.</p>
  </section>;
}

export function DatesLocationOutcome(props: Props) {
  const result = props.run.outcome!.result;
  return result.kind === "dates_location" ? <DatesLocationOutcomeBody {...props} result={result} /> : null;
}
export function DatesLocationOutcomeBody({ run, busy, act, call, runBase, result }: Props & { result: Extract<NonNullable<DatesLocationRunDetail["outcome"]>["result"], { kind: "dates_location" }> }) {
  const outcome = run.outcome!;
  const trip = run.trip, datesDiffer = trip.startsOn !== result.startsOn || trip.endsOn !== result.endsOn;
  const placeKnown = trip.locationNames.length === 1 && trip.locationNames.some(name => name.trim().toLocaleLowerCase() === result.place.toLocaleLowerCase());
  const [dates, setDates] = useState(datesDiffer), [location, setLocation] = useState(!placeKnown), command = useRef<{ key: string; id: string } | null>(null);
  const applied = outcome.status === "applied";
  async function apply() {
    const body = { outcomeId: outcome.id, expected: trip, applyDates: dates, applyLocation: location };
    command.current = stableCommand(command.current, body);
    await act(() => call(`${runBase}/apply`, "POST", { ...body, commandId: command.current!.id }), "Updated the trip.");
  }
  return <section className="recipe-section" aria-labelledby="recipe-outcome"><h2 id="recipe-outcome">{applied ? "Applied to the trip" : "Approved, not yet on the trip"}</h2>
    <div className="recipe-result"><strong>{formatRange(result.startsOn, result.endsOn)} · {result.place}</strong>
      <p className="recipe-fact">Approved by {outcome.approvedByName}. {result.basis.acceptedCount} of {result.basis.respondedCount} who answered could do it{result.basis.awaitingCount ? `; ${result.basis.awaitingCount} hadn’t answered` : ""}.</p>
      {result.exceptions.length ? <ul className="recipe-history">{result.exceptions.map(item => <li key={item}>{item}</li>)}</ul> : null}</div>
    {applied ? <>
      <p role="status" className="recipe-fact">Updated {[outcome.appliedTargets?.dates ? "dates" : "", outcome.appliedTargets?.location ? "location" : ""].filter(Boolean).join(" and ")}.</p>
      <StaleNotice outcome={outcome} />{outcome.stale.length ? null : <p className="recipe-note">Later changes to dates or location will show up here.</p>}
    </> : <>
      <h3>Update the trip</h3><p className="recipe-note">Choose what changes. Each is optional. Nothing else on the trip changes.</p>
      <label className="recipe-ack"><input type="checkbox" checked={dates} onChange={event => setDates(event.target.checked)} /><span>Dates</span><small>{formatRange(trip.startsOn, trip.endsOn)} → {formatRange(result.startsOn, result.endsOn)}</small></label>
      <label className="recipe-ack"><input type="checkbox" checked={location} disabled={placeKnown} onChange={event => setLocation(event.target.checked)} /><span>Location</span><small>{placeKnown ? `Already set to ${result.place}` : `${trip.locationNames.length ? trip.locationNames.join(", ") : "Not set"} → ${result.place}`}</small></label>
      <div className="poll-action-row"><button type="button" className="cm-action cm-action--primary" disabled={busy || (!dates && !location)} onClick={apply}>Update the trip</button></div>
      <p className="recipe-note">This changes the trip’s dates or location for everyone. It doesn’t book anything, notify anyone or change attendance.</p>
    </>}
  </section>;
}
