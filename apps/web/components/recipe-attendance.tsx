"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { attendanceLabels, formatTripDateRange, partySizeLabel, type AttendanceRunDetail, type AttendanceState } from "@commons/contracts";
import { stableCommand } from "@/lib/recipe-client";
import { NeedsForm, PublishPanel, StaleNotice, needResolutionPayload, needsResolved, type DraftLayout, type PanelProps } from "./recipe-shared";

type Props = PanelProps<AttendanceRunDetail>;
const tripLine = (trip: AttendanceRunDetail["trip"]) => `${trip.startsOn && trip.endsOn ? formatTripDateRange(trip.startsOn, trip.endsOn) : "Dates not set"}${trip.locationNames.length ? ` · ${trip.locationNames.join(", ")}` : ""}`;

export function AttendanceDraft({ run, busy, act, call, runBase, layout }: Props & { layout?: DraftLayout }) {
  const [title, setTitle] = useState(run.title), command = useRef<{ key: string; id: string } | null>(null);
  const askedTrip = run.askedTrip ?? run.trip;
  const datesSet = Boolean(askedTrip.startsOn && askedTrip.endsOn);
  async function refresh() {
    command.current = stableCommand(command.current, { title, version: run.draft.version });
    await act(() => call(`${runBase}/alternatives`, "POST", { commandId: command.current!.id, expectedDraftVersion: run.draft.version, title: title.trim() || undefined }), "The poll now asks about the trip as it is saved today.");
  }
  const build = <>
    <section className="recipe-section" aria-labelledby="recipe-asking"><h2 id="recipe-asking">What you’re asking</h2>
      <p className="recipe-fact">{tripLine(askedTrip)}</p>
      {!datesSet ? <p className="recipe-attention" role="status">The trip has no dates yet. Pick dates and a location first.</p> : null}
      <p className="recipe-note">The poll uses the trip’s saved dates and place. If they change, update the poll.</p>
      <label className="fieldnotes-field"><span>Poll title</span><input type="text" value={title} maxLength={120} onChange={event => setTitle(event.target.value)} /></label>
      <div className="poll-action-row"><button type="button" className="cm-action" disabled={busy} onClick={refresh}>Update the poll to match the trip</button></div>
    </section>
    <section className="recipe-section" aria-labelledby="recipe-preview"><h2 id="recipe-preview">What people will see</h2>
      <div className="recipe-preview"><strong>Will you be there?</strong><ul>{(["in", "maybe", "out"] as AttendanceState[]).map(state => <li key={state}>{attendanceLabels[state]}</li>)}</ul>
        <strong>How many people are you answering for, including you?</strong><p className="recipe-note">Optional. If it’s left blank, we count one and say so.</p>
        <strong>Anything the organizers should know?</strong><p className="recipe-note">Optional, in their own words.</p></div>
      <p className="recipe-note">An answer here goes to the organizers. It doesn’t accept an invitation, create an account or change anyone’s RSVP on the trip.</p>
    </section>
  </>;
  const share = <PublishPanel run={run} busy={busy} act={act} call={call} runBase={runBase} ready={datesSet && title === run.title} blockedReason={!datesSet ? "Set the trip dates first." : "Save your changes before sharing."} />;
  return layout ? layout(build, share) : <>{build}{share}</>;
}

const GROUPS: Array<{ state: AttendanceState | "unanswered"; label: string }> = [{ state: "in", label: "In" }, { state: "maybe", label: "Maybe" }, { state: "out", label: "Out" }, { state: "unanswered", label: "Not answered" }];

export function AttendanceSummaryView({ run }: { run: AttendanceRunDetail }) {
  const summary = run.summary!, link = run.poll?.audienceKind === "link";
  return <section className="recipe-section" aria-labelledby="recipe-who"><h2 id="recipe-who">Who’s coming</h2>
    <p role="status" className="recipe-count">{summary.counts.in} in · {summary.counts.maybe} maybe · {summary.counts.out} out{link ? "" : ` · ${summary.counts.unanswered} not answered`}. Covers {summary.headcount.in} {summary.headcount.in === 1 ? "person" : "people"} in{summary.headcount.maybe ? ` and ${summary.headcount.maybe} maybe` : ""}.</p>
    {link ? <p className="recipe-note">This poll is open to anyone with the link, so we can’t say who is still to answer.</p> : null}
    {summary.headcount.assumedOne.length ? <p className="recipe-note">No party size given, so counted as one: {summary.headcount.assumedOne.join(", ")}.</p> : null}
    <p className="recipe-note">Their answers to the organizers, as given. They don’t change anyone’s RSVP or access.</p>
    <div className="recipe-groups">{GROUPS.filter(group => !(link && group.state === "unanswered")).map(group => { const members = summary.people.filter(person => person.state === group.state); return <div key={group.state}><h3>{group.label} ({members.length})</h3>
      {members.length ? <ul className="recipe-history">{members.map(person => <li key={person.key + (person.responseId ?? "")}>{person.name}{person.partySize ? ` · ${partySizeLabel(person.partySize)}` : ""}{person.source === "organizer_entered" ? ` · noted by ${person.enteredBy}` : ""}{person.note ? ` · “${person.note}”` : ""}</li>)}</ul> : <p className="recipe-note">No one.</p>}</div>; })}</div>
    {summary.duplicates.length ? <p className="recipe-attention" role="status">{summary.duplicates.map(item => item.name).join(", ")} answered more than once as a guest. You’ll choose which answer to count before recording attendance.</p> : null}
  </section>;
}

type Entry = { state: "" | AttendanceState; partySize: string; note: string };
export function AttendanceDecide({ run, busy, act, call, runBase }: Props) {
  const poll = run.poll!, summary = run.summary!;
  const [keep, setKeep] = useState<Record<string, string>>({}), [entries, setEntries] = useState<Record<string, Entry>>({}), [exceptions, setExceptions] = useState(""), [ack, setAck] = useState(false), [resolutions, setResolutions] = useState<Record<string, string>>({});
  const command = useRef<{ key: string; id: string } | null>(null);
  const answeredNames = new Set(summary.people.filter(person => person.source === "response").map(person => person.name.trim().toLocaleLowerCase()));
  // Duplicate groups aside, anyone on the trip who hasn't answered can have an organizer-attributed note.
  const candidates = run.people.filter(person => !answeredNames.has(person.name.trim().toLocaleLowerCase()));
  const excluded = summary.duplicates.flatMap(group => keep[group.name] ? group.responseIds.filter(id => id !== keep[group.name]) : []);
  const duplicatesOpen = summary.duplicates.some(group => !keep[group.name]);
  const lines = exceptions.split("\n").map(line => line.trim()).filter(Boolean);
  const hasAttendance = summary.people.some(person => person.source === "response" && person.state !== "unanswered") || Object.values(entries).some(entry => Boolean(entry.state));
  const ready = hasAttendance && ack && !duplicatesOpen && needsResolved(run, resolutions) && Boolean(run.evidenceFingerprint) && lines.length <= 10;
  async function approve() {
    const organizerEntries = Object.entries(entries).filter(([, entry]) => entry.state).map(([personId, entry]) => ({ personId, state: entry.state, partySize: entry.partySize ? Number(entry.partySize) : null, note: entry.note.trim() || null }));
    const body = { pollId: poll.id, evidenceFingerprint: run.evidenceFingerprint, exceptions: lines, organizerEntries, excludedResponseIds: excluded, uncertaintyAcknowledged: true, needResolutions: needResolutionPayload(run, resolutions) };
    command.current = stableCommand(command.current, body);
    await act(() => call(`${runBase}/outcome`, "POST", { ...body, commandId: command.current!.id }), "Attendance recorded. Nobody’s own RSVP changed.");
  }
  return <section className="recipe-section" aria-labelledby="recipe-decide"><h2 id="recipe-decide">Record attendance</h2>
    <p className="recipe-note">Voting is closed. Recording keeps these counts to plan from. It doesn’t confirm anyone’s attendance.</p>
    {summary.duplicates.map(group => <fieldset className="recipe-choice" key={group.name}><legend><strong>{group.name}</strong> answered more than once as a guest. Which answer should count?</legend>
      {group.answers.map(item => <label key={item.responseId}><input type="radio" name={`dup-${group.name}`} checked={keep[group.name] === item.responseId} onChange={() => setKeep({ ...keep, [group.name]: item.responseId })} /><span>{item.state ? attendanceLabels[item.state] : "No answer"}</span><small>{item.partySize ? partySizeLabel(item.partySize) : "No party size"}. The other answer is kept but not counted.</small></label>)}</fieldset>)}
    {candidates.length ? <details className="fieldnotes-context"><summary>Note what you’ve heard from someone ({candidates.length} people)</summary>
      <p className="recipe-note">Marked as your note, not their answer. It never changes their RSVP, and their own answer always wins.</p>
      <ul className="recipe-entry-list">{candidates.map(person => { const entry = entries[person.personId] ?? { state: "", partySize: "", note: "" }; const set = (patch: Partial<Entry>) => setEntries({ ...entries, [person.personId]: { ...entry, ...patch } });
        return <li key={person.personId}><strong>{person.name}</strong>
          <label className="fieldnotes-field"><span>What you heard</span><select value={entry.state} onChange={event => set({ state: event.target.value as Entry["state"] })}><option value="">Nothing to note</option>{(["in", "maybe", "out"] as AttendanceState[]).map(state => <option key={state} value={state}>{attendanceLabels[state]}</option>)}</select></label>
          {entry.state ? <><label className="fieldnotes-field"><span>People covered</span><select value={entry.partySize} onChange={event => set({ partySize: event.target.value })}><option value="">Not stated</option>{[1, 2, 3, 4, 5, 6].map(size => <option key={size} value={size}>{partySizeLabel(size)}</option>)}</select></label>
            <label className="fieldnotes-field"><span>Note (optional)</span><input type="text" maxLength={300} value={entry.note} onChange={event => set({ note: event.target.value })} placeholder="For example, said so on the phone" /></label></> : null}</li>; })}</ul></details> : null}
    <NeedsForm run={run} resolutions={resolutions} onChange={setResolutions} />
    <label className="fieldnotes-field"><span>Exceptions or conditions (optional, one per line)</span><textarea rows={3} value={exceptions} onChange={event => setExceptions(event.target.value)} /></label>
    <label className="recipe-ack"><input type="checkbox" checked={ack} onChange={event => setAck(event.target.checked)} /><span className="recipe-ack__text">I understand these are answers to the organizers, not RSVPs, and that people who haven’t answered aren’t counted.</span></label>
    <div className="poll-action-row"><button type="button" className="cm-action cm-action--primary" disabled={busy || !ready} onClick={approve}>Record attendance</button></div>
    {duplicatesOpen ? <p className="recipe-note">Choose which answer to count for each guest who answered twice.</p> : null}
    {!hasAttendance ? <p className="recipe-note">Add an answer or a note before recording. Any earlier attendance decision stays in effect.</p> : null}
  </section>;
}

export function AttendanceOutcome({ run, slug }: Props & { slug: string }) {
  const outcome = run.outcome!, result = outcome.result;
  if (result.kind !== "attendance") return null;
  // getRecipeRun pairs the outcome and poll from the same round, never a later revision.
  const knownAudience = run.poll?.audienceKind === "invitees";
  return <section className="recipe-section" aria-labelledby="recipe-outcome"><h2 id="recipe-outcome">Attendance recorded</h2>
    <div className="recipe-result"><strong>{result.counts.in} in · {result.counts.maybe} maybe · {result.counts.out} out{knownAudience ? ` · ${result.counts.unanswered} not answered` : ""}</strong>
      {!knownAudience ? <p className="recipe-note">We can’t say who is still to answer this poll.</p> : null}
      <p className="recipe-fact">Covers {result.headcount.in} {result.headcount.in === 1 ? "person" : "people"} in{result.headcount.maybe ? ` and ${result.headcount.maybe} maybe` : ""}. Recorded by {outcome.approvedByName}. Asked about {tripLine(result.basedOn)}.</p>
      {result.people.some(person => person.source === "organizer_entered") ? <><p className="recipe-note">Includes organizer notes, not additional poll responses:</p><ul className="recipe-history">{result.people.filter(person => person.source === "organizer_entered").map(person => <li key={person.personId ?? person.name}><strong>{person.name}</strong>: {person.state === "unanswered" ? "Not answered" : attendanceLabels[person.state]}{person.partySize ? ` · ${partySizeLabel(person.partySize)}` : ""}. Added by {person.enteredBy ?? outcome.approvedByName}.{person.note ? ` ${person.note}` : ""}</li>)}</ul></> : null}
      {result.excludedResponses ? <p className="recipe-note">{result.excludedResponses} duplicate guest {result.excludedResponses === 1 ? "answer was" : "answers were"} not counted.</p> : null}
      {result.exceptions.length ? <ul className="recipe-history">{result.exceptions.map(item => <li key={item}>{item}</li>)}</ul> : null}</div>
    <StaleNotice outcome={outcome} />
    <p className="recipe-note">No one’s RSVP, access, or invitation changed. Use this headcount to plan lodging and transport.</p>
    <div className="poll-action-row"><Link className="cm-action" href={`/c/${encodeURIComponent(slug)}/recipes?new=lodging`}>Next: find a place to stay</Link></div>
  </section>;
}
