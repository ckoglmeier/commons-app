"use client";
import type { PollDetail } from "@commons/contracts";
import { useRef, useState } from "react";
import { PollDecisionActions } from "./poll-decision-actions";

export function PollDecisionReview({ slug, poll }: { slug: string; poll: PollDetail }) {
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState("");
  const [target, setTarget] = useState<"record" | "plan_idea">("record");
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [acknowledged, setAcknowledged] = useState(false);
  const [expand, setExpand] = useState(false);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const command = useRef<string | null>(null);
  const inFlight = useRef(false);
  const needs = poll.responses.flatMap(response => (response.answers ?? []).flatMap(answer => answer.context?.kind === "need" ? [{ responseId: response.id, questionId: answer.questionId, text: answer.context.text, name: response.respondentName, key: `${response.id}:${answer.questionId}` }] : []));
  const choices = Object.entries(selected).filter(([, value]) => Boolean(value)).map(([questionId, optionId]) => ({ questionId, optionId }));
  const writtenOnly = poll.questions.every(question => question.kind === "text");
  const compatible = poll.responses.filter(response => choices.every(choice => response.answers?.some(answer => answer.questionId === choice.questionId && answer.optionIds.includes(choice.optionId)))).length;
  const ready = (writtenOnly || choices.length > 0) && summary.trim() && acknowledged && needs.every(need => resolutions[need.key]?.trim()) && (target !== "plan_idea" || expand);

  async function approve() {
    if (!ready || !review || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); command.current ??= crypto.randomUUID();
    try {
      const response = await fetch(`/api/v1/commons/${encodeURIComponent(slug)}/polls/${poll.id}/decision`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        commandId: command.current, evidenceFingerprint: poll.evidenceFingerprint, selected: choices, summary, target,
        needResolutions: needs.map(need => ({ responseId: need.responseId, questionId: need.questionId, resolution: resolutions[need.key] })),
        uncertaintyAcknowledged: acknowledged, audienceExpansionApproved: expand,
      }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Couldn’t save the decision. Try again.");
      window.location.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn’t save the decision. Try again."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  if (poll.decision) return <section className="poll-responses"><h2>What was decided</h2><p>{poll.decision.summary}</p><p>{poll.decision.approvedByName} approved this · {new Date(poll.decision.approvedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p><p>{poll.decision.target === "plan_idea" ? "Added to Plan as an idea for everyone." : "Saved here for people in this poll."}</p><PollDecisionActions slug={slug} poll={poll} /></section>;
  if (!poll.currentActorCanManage) return null;
  if (poll.questions.some(question => question.kind !== "choice" && question.kind !== "text")) return <section className="poll-responses"><h2>Review these preferences</h2><p>This form can’t record grouped responses, rankings, or points. Review the results in the recipe. An exploratory round can’t update the trip.</p></section>;
  if (poll.status !== "closed") return <section className="poll-responses"><h2>Decide when voting closes</h2><p>Close voting to review the answers.</p></section>;
  return <section className="poll-responses"><h2>{review ? "Review your decision" : "Make a decision"}</h2>
    {!review ? <fieldset className="fieldnotes-editing" disabled={busy}>
      {poll.questions.filter(question => question.kind === "choice").map(question => question.kind === "choice" ? <label className="fieldnotes-field" key={question.id}><span>{question.prompt}</span><select value={selected[question.id] ?? ""} onChange={event => { command.current = null; setSelected({ ...selected, [question.id]: event.target.value }); }}><option value="">Not deciding this yet</option>{question.options.map(option => <option value={option.id} key={option.id}>{option.label}</option>)}</select></label> : null)}
      <p>{writtenOnly ? poll.ballotMode === "secret" ? "Answers stay anonymous. Your summary is your decision, not everyone’s agreement." : "Written answers can explain your decision. They don’t mean everyone agrees." : poll.ballotMode === "secret" ? "Choices stay private in a secret poll." : choices.length ? `${compatible} of ${poll.responseCount} responses chose all these options. Check conditions and needs. People who haven’t answered aren’t counted.` : "Choose options to see who picked them together."}</p>
      {needs.map(need => <label className="fieldnotes-field" key={need.key}><span>Private · {need.name} needs: {need.text}</span><textarea maxLength={500} value={resolutions[need.key] ?? ""} onChange={event => { command.current = null; setResolutions({ ...resolutions, [need.key]: event.target.value }); }} /><small>Say how you’ll handle this, or why you can’t. This note doesn’t go in Plan.</small></label>)}
      <label className="fieldnotes-field"><span>Your decision</span><textarea maxLength={500} value={summary} onChange={event => { command.current = null; setSummary(event.target.value); }} /><small>Leave out private notes.</small></label>
      <label className="fieldnotes-field"><span>Where should this go?</span><select value={target} onChange={event => { command.current = null; setTarget(event.target.value as typeof target); setExpand(false); }}><option value="record">Keep it in this poll</option>{poll.currentActorRole === "organizer" ? <option value="plan_idea">Add an idea to Plan for everyone</option> : null}</select></label>
      <label className="fieldnotes-toolbar"><input type="checkbox" checked={acknowledged} onChange={event => { command.current = null; setAcknowledged(event.target.checked); }} />I’ve checked missing answers, ties, conditions, and needs. This is my decision, not everyone’s agreement or RSVP.</label>
      {target === "plan_idea" ? <label className="fieldnotes-toolbar"><input type="checkbox" checked={expand} onChange={event => { command.current = null; setExpand(event.target.checked); }} />Share this summary with everyone on the trip, including people outside this poll.</label> : null}
      <button className="cm-action cm-action--primary" type="button" disabled={!ready} onClick={() => setReview(true)}>Review decision</button>
    </fieldset> : <div><p>{summary}</p><ul>{choices.map(choice => { const question = poll.questions.find(item => item.id === choice.questionId); return <li key={choice.questionId}>{question?.prompt}: {question?.kind === "choice" ? question.options.find(option => option.id === choice.optionId)?.label : ""}</li>; })}</ul><p>{target === "plan_idea" ? "Everyone on the trip will see this as an idea in Plan. Dates, bookings, and RSVPs don’t change." : "Only people in this poll can see the decision. The plan doesn’t change."}</p><div className="poll-action-row"><button className="cm-action" type="button" disabled={busy} onClick={() => { setReview(false); command.current = null; }}>Edit decision</button><button className="cm-action cm-action--primary" type="button" disabled={busy} onClick={approve}>{busy ? "Approving…" : "Approve decision"}</button></div></div>}
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
