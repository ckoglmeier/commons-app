"use client";
import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { MAX_POLL_QUESTIONS, type FoodRunDetail } from "@commons/contracts";
import { stableCommand } from "@/lib/recipe-client";
import { GoalStages } from "./goal-stages";
import { History, ParticipantPollPreview, PollShareLink, PublishPanel, ReviseRoundControl, type PanelProps } from "./recipe-shared";

type Question = { id: string; prompt: string; required: boolean; foodField: "requirements" | "preferences" | "notes" };
export function FoodRecipe({ run, slug, goal, ...props }: PanelProps<FoodRunDetail> & { slug: string; goal?: ReactNode }) {
  const [title, setTitle] = useState(run.title), [intro, setIntro] = useState(run.participantPreview?.intro ?? "");
  const original = (run.participantPreview?.questions ?? []).filter(q => q.kind === "text").map(q => ({ id: q.id, prompt: q.prompt, required: q.required, foodField: q.foodField ?? "notes" }));
  const [questions, setQuestions] = useState<Question[]>(original);
  const [close, setClose] = useState(false), saveCommand = useRef<{ key: string; id: string } | null>(null), closeCommand = useRef<string | null>(null), editingVersion = useRef(run.draft.version);
  const dirty = title !== run.title || intro !== (run.participantPreview?.intro ?? "") || JSON.stringify(questions) !== JSON.stringify(original);
  const supported = original.length === run.participantPreview?.questions.length;
  const ready = supported && Boolean(title.trim()) && questions.length > 0 && questions.every(q => q.prompt.trim());
  const update = (id: string, change: Partial<Question>) => setQuestions(value => value.map(q => q.id === id ? { ...q, ...change } : q));
  const move = (index: number, direction: number) => setQuestions(value => { const next = [...value]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; return next; });
  const summary = run.summary;
  const earlier = (run.earlierFoodAnswers ?? []).filter(source => source.value.responseCount > 0);
  const current = run.poll && !run.poll.superseded && run.stage !== "closed";
  const build = <>
    {goal}
    {run.stage === "draft" ? <section className="recipe-section" aria-label="Edit poll">
      <h3>Your poll</h3>
      <label className="fieldnotes-field"><span>Poll title</span><input value={title} maxLength={120} disabled={props.busy} onChange={event => setTitle(event.target.value)} /></label>
      <label className="fieldnotes-field"><span>Introduction · optional</span><textarea value={intro} maxLength={500} disabled={props.busy} onChange={event => setIntro(event.target.value)} /></label>
      {supported ? <>{questions.map((q, index) => <fieldset className="goal-question" key={q.id}><legend>Question {index + 1}</legend>
        <label className="fieldnotes-field"><span>Question</span><input value={q.prompt} maxLength={240} disabled={props.busy} onChange={event => update(q.id, { prompt: event.target.value })} /></label>
        <details><summary>Question settings</summary><label className="fieldnotes-field"><span>Use answers for</span><select value={q.foodField} disabled={props.busy} onChange={event => update(q.id, { foodField: event.target.value as Question["foodField"] })}><option value="requirements">Must accommodate</option><option value="preferences">Food preferences</option><option value="notes">Other meal notes</option></select></label>
        <label className="goal-question__required"><input type="checkbox" checked={q.required} disabled={props.busy} onChange={event => update(q.id, { required: event.target.checked })} />Required</label>
        <div className="poll-action-row"><button type="button" className="cm-action cm-action--link" aria-label={`Move question ${index + 1} up`} disabled={props.busy || index === 0} onClick={() => move(index, -1)}>Move up</button><button type="button" className="cm-action cm-action--link" aria-label={`Move question ${index + 1} down`} disabled={props.busy || index === questions.length - 1} onClick={() => move(index, 1)}>Move down</button><button type="button" className="cm-action cm-action--link" aria-label={`Remove question ${index + 1}`} disabled={props.busy || questions.length === 1} onClick={() => setQuestions(value => value.filter(item => item.id !== q.id))}>Remove</button></div>
      </details></fieldset>)}<button type="button" className="cm-action" disabled={props.busy || questions.length >= MAX_POLL_QUESTIONS} onClick={() => setQuestions(value => [...value, { id: crypto.randomUUID(), prompt: "", required: false, foodField: "notes" }])}>Add a question</button></> : <p>This draft contains other question types. Continue editing it with the Coordinator; your existing questions have not been replaced.</p>}
      <div className="poll-action-row"><button type="button" className="cm-action cm-action--primary" disabled={props.busy || !dirty || !ready} onClick={() => {
        const data = { title, intro, questions, expectedDraftVersion: editingVersion.current };
        saveCommand.current = stableCommand(saveCommand.current, data);
        void props.act(() => props.call(`${props.runBase}/alternatives`, "POST", { ...data, commandId: saveCommand.current!.id }), "Poll saved.");
      }}>Save poll</button></div>
    </section> : <section className="recipe-section"><ParticipantPollPreview run={run} /><p className="recipe-note">This shared round stays as published. Start another round to change its questions.</p><ReviseRoundControl run={run} {...props} /></section>}
  </>;
  const share = run.stage === "draft" ? <PublishPanel run={run} {...props} ready={ready && !dirty} blockedReason="Save your questions before sharing." /> : run.poll ? <section className="recipe-section">
    <PollShareLink poll={run.poll} />
    <p className="recipe-note">{run.poll.status === "closed" || !current ? "Voting is closed. The link still opens the saved poll." : run.poll.audienceKind === "invitees" ? "Trip invitees sign in to answer. Nothing is sent automatically." : "Anyone with the link can answer. Nothing is sent automatically."}</p>
    <Link className="cm-action" href={`/c/${encodeURIComponent(slug)}/polls/${run.poll.id}`}>See every answer</Link>
  </section> : <p>Build your poll first.</p>;
  const decide = <section className="recipe-section">
    <h3>Meal-planning summary</h3>
    {summary?.responseCount ? <><p>{summary.responseCount} {summary.responseCount === 1 ? "response" : "responses"}. Saved for meal planning and available to the Coordinator.</p>
      {([{ key: "requirements", title: "Must accommodate" }, { key: "preferences", title: "Food preferences" }, { key: "notes", title: "Other meal notes" }] as const).map(group => <section className="goal-food-group" key={group.key}><h4>{group.title}</h4><ul>{summary.entries.filter(e => e[group.key]).map(e => <li key={e.responseId}><strong>{e.name}:</strong> <span className="goal-answer">{e[group.key]}</span></li>)}</ul>{!summary.entries.some(e => e[group.key]) ? <p>No answers reported.</p> : null}</section>)}
      <p className="recipe-note">Blank answers don’t mean no restrictions. Confirm allergy accommodation with the restaurant before relying on it.</p></> : <p>{run.poll?.status === "closed" ? "Voting closed with no answers in this round." : earlier.length ? "No answers in this new round yet. Earlier reported needs remain below and available to the Coordinator." : "Answers will appear here as people respond."}</p>}
    {earlier.length ? <section aria-label="Earlier food answers"><h3>Earlier answers · not reconfirmed</h3><p>These are earlier-round reports, not answers to the new questions. A revision, missing answer or partial new round does not erase an allergy. Resolve any conflicts before planning meals.</p>
      {earlier.map((source, index) => <details key={source.id} open={index === 0 && !summary?.responseCount}><summary>{source.value.title} · {source.value.responseCount} earlier {source.value.responseCount === 1 ? "response" : "responses"}</summary>
        <Link href={`/c/${encodeURIComponent(slug)}/polls/${source.value.pollId}`}>View the source round</Link>
        {source.value.entries.map(entry => <div key={entry.responseId}><strong>{entry.name}</strong>{entry.requirements ? <p className="goal-answer">Must accommodate: {entry.requirements}</p> : null}{entry.preferences ? <p className="goal-answer">Preferences: {entry.preferences}</p> : null}{entry.notes ? <p className="goal-answer">Meal notes: {entry.notes}</p> : null}</div>)}
        {source.value.omittedResponses || source.value.entries.some(entry => entry.truncated) ? <p>Some earlier input is omitted or shortened. Open the source round before relying on it.</p> : null}
      </details>)}</section> : null}
    {(run.earlierFoodAnswers ?? []).some(source => source.value.historyIncomplete) ? <p role="status">Additional earlier rounds are outside this view. This is not a complete list of reported restrictions.</p> : null}
    {current && run.poll?.status === "closed" && summary?.responseCount ? <p role="status">Food collection finished. Saved answers remain available; no meal arrangement or allergy accommodation is confirmed.</p> : null}
    {current && run.poll?.status === "open" ? <><button type="button" className="cm-action" disabled={props.busy} onClick={() => setClose(true)}>Close voting</button>{close ? <div className="recipe-confirm" role="group" aria-label="Close voting"><p>Close voting? People won’t be able to add or change answers. {summary?.responseCount ? "This finishes food collection and removes it from Things to do. It does not confirm meal arrangements or allergy accommodation." : "With no saved answers, collection remains unfinished."} Saved answers remain available for planning.</p><button type="button" className="cm-action cm-action--primary" disabled={props.busy} onClick={() => { closeCommand.current ??= crypto.randomUUID(); void props.act(() => props.call(`/api/v1/commons/${encodeURIComponent(slug)}/polls/${run.poll!.id}`, "PATCH", { commandId: closeCommand.current, status: "closed" }), "Voting is closed."); }}>Close voting</button><button type="button" className="cm-action" disabled={props.busy} onClick={() => setClose(false)}>Keep it open</button></div> : null}</> : null}
    {run.poll?.status === "closed" ? <ReviseRoundControl run={run} {...props} /> : null}
  </section>;
  return <><GoalStages initialStage={run.stage === "draft" ? "build" : run.poll?.responseCount || run.poll?.status === "closed" ? "decide" : "share"} build={build} share={share} decide={decide} /><History slug={slug} run={run} /></>;
}
