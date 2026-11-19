"use client";

import { useEffect, useReducer, useRef, useState, type Dispatch } from "react";
import { CommonsWordmark, CoordinatorMark } from "@commons/ui";
import { currentRound, demoReducer, fixtureCompatible, goalMatchesSample, initialDemo, restoreDemo, roundError, sampleAnswers, STORAGE_KEY, taskStatus, type Action, type DemoState, type Question, type Round } from "./demo-state";
import styles from "./prototype.module.css";

const formats: Record<Question["kind"], string> = { dates: "Yes / Maybe / No · Abstain", interest: "Not interested / Could go / Interested / Top choice · Abstain", combination: "Choose every workable option · None exclusive", choice: "Choose one", text: "Written answer" };
const supported = ["Where are we?", "Show the questions", "Why another round?", "Ask dates only"];

export default function RecipeCoordinatorPrototype() {
  const [state, dispatch] = useReducer(demoReducer, undefined, initialDemo);
  const [storageWarning, storageFailed] = useReducer(() => "Browser storage is unavailable. This demo will last until you reload.", "");
  const workOpener = useRef<HTMLButtonElement>(null), composer = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    try { dispatch({ type: "restore", state: restoreDemo(sessionStorage.getItem(STORAGE_KEY)) }); }
    catch { dispatch({ type: "restore" }); storageFailed(); }
  }, []);
  useEffect(() => {
    if (!state.ready) return;
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch { storageFailed(); }
  }, [state]);
  const round = currentRound(state), task = state.task, isTask = state.selected === "recipe";
  const inspected = isTask && state.inspectedRound ? task?.rounds.find(item => item.id === state.inspectedRound) : null;
  const turns = isTask ? task?.turns ?? [] : state.mainTurns;
  const heading = isTask ? "Pick dates and location" : "Coordinator";
  const restoreWorkFocus = useRef(false);
  const goalInput = useRef<HTMLTextAreaElement>(null), focusGoal = useRef(false);
  useEffect(() => { if (state.pane === "work" && focusGoal.current) { focusGoal.current = false; goalInput.current?.focus(); } }, [state.pane]);
  useEffect(() => { if (state.pane === "conversation" && restoreWorkFocus.current) { restoreWorkFocus.current = false; workOpener.current?.focus(); } }, [state.pane]);
  function closeWork() { restoreWorkFocus.current = true; dispatch({ type: "pane", pane: "conversation" }); }
  function send() { dispatch({ type: "send", text: state.drafts[state.selected] }); }
  return <main className={styles.app}>
    <header className={styles.brand}><CommonsWordmark /><span>Wine country · 7 people</span><span className={styles.local}>Local prototype</span></header>
    <div className={styles.demoBanner}><p>Synthetic people and answers. This tab only; no AI, messages or real trip changes.</p><button type="button" onClick={() => { if (window.confirm("Reset this local demo? Its conversations, drafts and sample answers will be cleared.")) dispatch({ type: "reset" }); }}>Reset demo</button></div>
    {storageWarning ? <p role="status" className={styles.storageWarning}>{storageWarning}</p> : null}
    <nav className={styles.mobileTabs} aria-label="Workspace surface">{(["tasks", "conversation", "work"] as const).map(pane => <button type="button" key={pane} aria-current={state.pane === pane ? "page" : undefined} onClick={() => dispatch({ type: "pane", pane })}>{pane === "tasks" ? "Goals" : pane === "conversation" ? "Conversation" : "Work"}</button>)}</nav>
    <div className={styles.workspace} data-pane={state.pane}>
      <aside className={styles.tasks} aria-label="Goals and conversations">
        <div className={styles.paneHeading}><h2>Goals</h2><button type="button" onClick={() => dispatch({ type: "pane", pane: "conversation" })}>Close</button></div>
        <button className={styles.taskRow} type="button" data-selected={!isTask} aria-current={!isTask ? "page" : undefined} onClick={() => dispatch({ type: "select", destination: "main" })}><span>Coordinator</span><small>Main conversation{state.quick ? " · Quick poll" : ""}</small></button>
        <p className={styles.eyebrow}>Goals</p>
        {task ? <button className={styles.taskRow} type="button" data-selected={isTask} aria-current={isTask ? "page" : undefined} onClick={() => dispatch({ type: "select", destination: "recipe" })}><span>Pick dates and location</span><small>{taskStatus(task)} · {task.rounds.length === 1 ? "1 round" : `${task.rounds.length} rounds`}</small></button> : <p className={styles.quiet}>No goal yet. Start one from the main conversation.</p>}
        <div className={styles.railFoot}><span>Demo trip</span><strong>{task?.applied ? task.decision?.option : "Dates and location open"}</strong><p>Nothing booked. Attendance not confirmed.</p></div>
      </aside>
      <section className={styles.conversation} aria-label={`${heading} conversation`}>
        <header className={styles.conversationHeading}><button type="button" onClick={() => dispatch({ type: "pane", pane: "tasks" })} aria-label="Open Goals">Goals</button><div><h1>{heading}</h1><span>{isTask && task ? taskStatus(task) : "Robin’s organizer workspace"}</span></div><button ref={workOpener} type="button" aria-expanded={state.pane === "work"} onClick={() => state.pane === "work" ? closeWork() : dispatch({ type: "pane", pane: "work" })}>{state.pane === "work" ? "Close Work" : "Work"}</button></header>
        {isTask && task ? <div className={styles.goalSummary}>
          <button type="button" className={styles.editGoalLink} onClick={() => { if (state.pane === "work") goalInput.current?.focus(); else { focusGoal.current = true; dispatch({ type: "pane", pane: "work" }); } }}>Edit goal</button>
          <details><summary><strong>Goal</strong><span>{task.goal}</span></summary>
            <p className={styles.successCondition}>Success: a date-and-place combination that works for the group, with stated constraints handled and organizer approval.</p>
            <dl><div><dt>Settled</dt><dd>{task.decision ? task.decision.option : "Wine-country weekend · 7 people"}</dd></div><div><dt>Open</dt><dd>{task.applied ? "Booking and attendance, outside this goal" : task.decision ? "Apply the reviewed trip update" : round?.number === 2 ? "Combination fit and Maya’s travel need" : "Dates and destination fit"}</dd></div></dl>
            <label className={styles.goalEditor}>Edit goal<input aria-label="Goal" value={task.goal} maxLength={180} onChange={event => dispatch({ type: "goal", text: event.target.value })} /></label>
            <small>Local edit · does not change questions or evidence</small>
          </details>
          <p className={styles.nextSummary}><span>Next</span>{!goalMatchesSample(task) ? "Review the changed goal" : task.applied ? "Completed · inspect the decision" : task.decision ? "Update demo trip, separately" : round?.coverage ? "Review answers in Work" : round?.shared ? "Wait for answers" : "Review and share the draft"}</p>
        </div> : null}
        <div className={styles.transcript}>
          {turns.map(item => <article className={styles.turn} key={item.id} data-author={item.who}><div className={styles.author}>{item.who === "Commons" ? <CoordinatorMark /> : <span className={styles.initial}>R</span>}<strong>{item.who}</strong>{item.who === "Commons" ? <span>Demo coordinator</span> : <span>Organizer</span>}</div><p>{item.text}</p></article>)}
          {!isTask ? <div className={styles.starters}><p className={styles.eyebrow}>Start with a goal</p><button type="button" onClick={() => dispatch({ type: "start-recipe" })}><span>{task ? "Resume: Pick dates and location" : "Pick a date and location"}</span><small>{task ? `Same goal · ${taskStatus(task)}` : "Goal · one focused conversation, across every round"}</small><span aria-hidden="true">→</span></button><button type="button" onClick={() => dispatch({ type: "quick-poll" })}><span>{state.quick ? "Open Friday dinner poll" : "Prepare a quick poll"}</span><small>One direct question · stays in this conversation</small><span aria-hidden="true">→</span></button>{task?.applied ? <p className={styles.receipt}>Completed decision: {task.decision?.option}. <button type="button" onClick={() => dispatch({ type: "select", destination: "recipe" })}>Inspect goal</button></p> : null}</div> : round ? <div className={styles.handoff}><span>{task?.decision ? "Reviewed decision" : `Round ${round.number} · ${round.shared ? `${round.coverage}/7 answered` : "Private draft"}`}</span><button type="button" onClick={() => dispatch({ type: "pane", pane: "work" })}>{task?.decision ? "Review decision" : round.coverage ? "Review answers" : "Open working message"}</button></div> : null}
        </div>
        <div className={styles.composer}><label htmlFor="demo-composer">To: {heading}</label><textarea id="demo-composer" ref={composer} value={state.drafts[state.selected]} placeholder="Steer this example…" maxLength={1000} rows={2} onChange={event => dispatch({ type: "draft", text: event.target.value })} onKeyDown={event => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); send(); } }} /><div className={styles.composerActions}><small>Bounded preview · no connected AI</small><button className={styles.primary} type="button" disabled={!state.ready || !state.drafts[state.selected].trim()} onClick={send}>Send</button></div><details className={styles.prompts}><summary>Try an example prompt</summary><div>{(isTask ? supported : ["Where are we?", "Pick a date and location", "Prepare a quick poll"]).map(prompt => <button type="button" key={prompt} onClick={() => { dispatch({ type: "draft", text: prompt }); composer.current?.focus(); }}>{prompt}</button>)}</div></details></div>
      </section>
      <section className={styles.work} aria-label="Working material"><div className={styles.paneHeading}><h2>Work</h2><button type="button" onClick={closeWork}>Back to conversation</button></div>
        {isTask && task && !goalMatchesSample(task) ? <p className={styles.notice}>Goal changed. Sample evidence still describes the original goal; completion is paused until the revised goal can be evaluated.</p> : null}
        {isTask && task ? <div className={styles.workGoal}><label>Goal<textarea ref={goalInput} aria-label="Edit goal" value={task.goal} maxLength={180} rows={3} onChange={event => dispatch({ type: "goal", text: event.target.value })} /></label><small>Saved in this tab. This scripted preview does not regenerate questions when the goal changes.</small><details><summary>What success means</summary><p>A date-and-place combination that works for the group, with stated constraints handled and organizer approval.</p></details></div> : null}
        {round ? <WorkingDocument key={`${round.id}:${inspected?.id ?? "current"}`} state={state} round={inspected ?? round} historical={Boolean(inspected && inspected.id !== round.id)} dispatch={dispatch} /> : <div className={styles.emptyWork}><CoordinatorMark /><h2>No working material yet</h2><p>Choose a goal or prepare a quick poll. Opening Work alone creates nothing.</p><button type="button" onClick={closeWork}>Return to conversation</button></div>}
      </section>
    </div>
  </main>;
}

function WorkingDocument({ state, round, historical, dispatch }: { state: DemoState; round: Round; historical: boolean; dispatch: Dispatch<Action> }) {
  const [editing, setEditing] = useState(false), [reviewing, setReviewing] = useState(false), [selection, setSelection] = useState("");
  const [ack, setAck] = useState(false);
  const shareDialog = useRef<HTMLDialogElement>(null), shareOpener = useRef<HTMLButtonElement>(null);
  const task = state.selected === "recipe" ? state.task : null;
  const decision = task?.decision, editable = !historical && !round.shared, fixture = fixtureCompatible(round);
  const error = roundError(round);
  const update = (patch: Partial<Round>) => dispatch({ type: "edit-round", round: { ...round, ...patch } });
  const updateQuestion = (id: string, patch: Partial<Question>) => update({ questions: round.questions.map(question => question.id === id ? { ...question, ...patch } : question) });
  function addQuestion(kind: "choice" | "text") { update({ questions: [...round.questions, { id: crypto.randomUUID(), kind, prompt: kind === "choice" ? "One related choice" : "Anything else we should consider?", required: false, options: kind === "choice" ? ["Option one", "Option two"] : [] }] }); }
  return <>
    <div className={styles.documentMeta}><span>{historical ? "Earlier round · Read only" : round.shared ? "Shared demo snapshot" : "Private proposal"} · {task ? `Round ${round.number}` : "Quick poll"}</span>{task && task.rounds.length > 1 ? <details><summary>Earlier rounds</summary>{task.rounds.map(item => <button type="button" key={item.id} onClick={() => dispatch({ type: "inspect", roundId: item.id === task.rounds.at(-1)?.id ? null : item.id })}>Round {item.number} · {item.coverage}/7 answered{item.id === round.id ? " · Viewing" : ""}</button>)}</details> : null}</div>
    {historical ? <p className={styles.notice}>Original questions and answers retained. These answers were not carried into the next round. <button type="button" onClick={() => dispatch({ type: "inspect", roundId: null })}>Back to current round</button></p> : null}
    <article className={styles.paper}>
      {editable ? <><label className={styles.titleField}>Group message title<input aria-label="Group message title" value={round.title} maxLength={120} onChange={event => update({ title: event.target.value })} /></label><label className={styles.messageField}>Message to the group<textarea aria-label="Message to the group" value={round.message} rows={5} maxLength={1500} onChange={event => update({ message: event.target.value })} /></label></> : <><h2>{round.title}</h2><p className={styles.groupMessage}>{round.message}</p></>}
      <div className={styles.documentSectionHeading}><h3>Questions for the group</h3>{editable ? <button type="button" aria-expanded={editing} onClick={() => setEditing(!editing)}>{editing ? "Done editing" : "Edit questions"}</button> : null}</div>
      {round.questions.map((question, index) => <section className={styles.question} key={question.id}>
        {editing && editable ? <><label>Question {index + 1}<input value={question.prompt} maxLength={240} onChange={event => updateQuestion(question.id, { prompt: event.target.value })} /></label><div className={styles.inlineControls}><span>{formats[question.kind]}</span><label className={styles.check}><input type="checkbox" checked={question.required} onChange={event => updateQuestion(question.id, { required: event.target.checked })} />Required</label><button type="button" disabled={round.questions.length <= 1} onClick={() => update({ questions: round.questions.filter(item => item.id !== question.id) })}>Remove question</button></div>{question.options.map((option, optionIndex) => <label key={optionIndex}>Option {optionIndex + 1}<input value={option} maxLength={160} onChange={event => updateQuestion(question.id, { options: question.options.map((item, position) => position === optionIndex ? event.target.value : item) })} /></label>)}{question.kind !== "text" ? <button type="button" disabled={question.options.length >= 5} onClick={() => updateQuestion(question.id, { options: [...question.options, ""] })}>Add option</button> : null}</> : <><h4>{index + 1}. {question.prompt}</h4><p className={styles.format}>{formats[question.kind]} · {question.required ? "Required" : "Optional"}</p><ul>{question.options.map((option, position) => <li key={position}>{option}</li>)}{question.kind === "combination" ? <li>None of these work for me <small>· exclusive</small></li> : null}</ul>{question.kind === "text" ? <p className={styles.quiet}>{question.required ? "Required" : "Optional"} written response</p> : null}</>}
      </section>)}
      {editable && editing ? <div className={styles.actions}><button type="button" disabled={round.questions.length >= 5} onClick={() => addQuestion("choice")}>Add a related choice</button><button type="button" disabled={round.questions.length >= 5} onClick={() => addQuestion("text")}>Add a written question</button></div> : null}
      <p className={styles.format}>Anything else? (optional) · Notes to Robin, not a group conversation.</p>
      {editable ? <div className={styles.shareFooter}>{error ? <p className={styles.error} role="status">{error}</p> : null}{!fixture ? <p className={styles.notice}>You’ve changed the seeded message or questions. Sharing can preview your wording, but sample answers and decisions are unavailable for an edited title, message, prompt, required flag or option. Reset demo to run the sample journey.</p> : null}<p className={styles.quiet}>Edits stay in this tab. Nothing is shared until you confirm.</p><button ref={shareOpener} className={styles.primary} type="button" disabled={Boolean(error)} onClick={() => shareDialog.current?.showModal()}>Share with the group</button></div> : null}
    </article>
    {round.shared ? <>
      {!historical ? <section className={styles.demoControls}><h3>Demo controls</h3><p>Load synthetic responses to this seeded snapshot. These are not live participant answers.</p><div className={styles.actions}><button type="button" disabled={!fixture || round.coverage >= 3} onClick={() => dispatch({ type: "responses", count: 3 })}>Load 3 of 7 answers</button><button type="button" disabled={!fixture || round.coverage === 7} onClick={() => dispatch({ type: "responses", count: 7 })}>Load all 7 answers</button></div>{!fixture ? <p className={styles.error}>This edited message or question set has no matching fixture. Reset demo to use sample evidence.</p> : null}</section> : null}
      {round.coverage ? <Results round={round} quick={!task} resolvedNeed={!historical ? decision?.resolution : undefined} /> : <section className={styles.results}><h3>Waiting for responses</h3><p>0 of 7 answered. No fit has been established.</p></section>}
      {!historical && task && round.coverage > 0 && !decision ? <section className={styles.nextAction}>
        <h3>What to do next</h3>
        {round.coverage < 7 ? <p>Keep this round open. Maya, Jules, Dev and Tess have not answered. Their silence is not a yes. In this preview, load the remaining sample answers to continue.</p> : round.number === 1 ? <>
          <p>Ask once more about the actual combination. Independent date and destination tallies don’t prove the same people can make it; Maya’s Thursday-travel constraint still matters.</p>
          <button className={styles.primary} type="button" onClick={() => dispatch({ type: "follow-up" })}>Prepare focused follow-up</button>
          <p className={styles.quiet}>Same goal · new private round · no copied votes</p>
        </> : <>
          <p>The first combination was selected as workable by all seven sample respondents. Before recording a decision, explain how Maya’s travel constraint will be handled.</p>
          <label>Maya’s need from Round 1<span className={styles.needQuote}>“I can’t take Thursday off. I could arrive Friday evening.”</span><textarea aria-label="How Maya’s need will be handled" rows={3} maxLength={500} value={task.needResolution} onChange={event => dispatch({ type: "resolve-need", text: event.target.value })} placeholder="For example: Maya joins Friday evening; no Thursday travel is required." /></label>
          <p className={styles.quiet}>Your explanation is recorded as organizer judgment, not independently checked.</p>
          <fieldset className={styles.decisionChoice}><legend>Choose the reviewed result</legend>{round.questions.find(question => question.kind === "combination")?.options.map((option, index) => <label className={styles.check} key={option}><input type="radio" name="decision" checked={selection === option} disabled={index !== 0} onChange={() => { setSelection(option); setAck(false); setReviewing(false); }} />{option}<small>{index === 0 ? "7 of 7 selected as workable" : "Only 3 of 7 selected it. Fit remains unresolved; not selectable in this strong-fit demo."}</small></label>)}</fieldset>
          <button className={styles.primary} type="button" disabled={!selection || !task.needResolution.trim() || !goalMatchesSample(task)} onClick={() => setReviewing(true)}>Review decision</button>
          {reviewing ? <div className={styles.review}>
            <h3>Review before recording</h3><p><strong>{selection}</strong></p>
            <p>Based on Round 2 · 7 of 7 responses. All seven selected this combination as workable.</p>
            <p>Maya’s accommodation: {task.needResolution}</p>
            <label className={styles.check}><input type="checkbox" checked={ack} onChange={event => setAck(event.target.checked)} />I’ve reviewed the answers and stated need. This does not confirm attendance or update the trip.</label>
            <button className={styles.primary} type="button" disabled={!ack || !goalMatchesSample(task)} onClick={() => dispatch({ type: "approve", option: selection })}>Record reviewed demo decision</button>
            <button type="button" onClick={() => setReviewing(false)}>Keep reviewing</button>
          </div> : null}
        </>}
      </section> : null}
    </> : null}
    {!historical && decision ? <section className={styles.decisionReceipt}><h3>{task?.applied ? "Completed decision" : "Reviewed decision · trip unchanged"}</h3><p><strong>{decision.option}</strong></p><p>Reviewed by Robin · Round 2 evidence · 7 of 7 sample responses.</p><p>Maya’s accommodation: {decision.resolution}</p>{task?.applied ? <p role="status">Demo trip dates and location updated. Nothing booked, sent or paid.</p> : <><h4>Update demo trip, separately</h4><dl><div><dt>Dates</dt><dd>Not set → {decision.option.split(" · ")[0]}</dd></div><div><dt>Location</dt><dd>Not set → {decision.option.split(" · ")[1]}</dd></div></dl><button className={styles.primary} type="button" disabled={!task || !goalMatchesSample(task)} onClick={() => dispatch({ type: "apply-trip" })}>Update demo trip dates and location</button><p className={styles.quiet}>Simulated only. No attendance, booking or notification changes.</p></>}</section> : null}
    <dialog className={styles.dialog} ref={shareDialog} aria-labelledby="demo-share-heading" onClose={() => shareOpener.current?.focus()}><h2 id="demo-share-heading">Share this demo round?</h2><p>Make the exact displayed message and questions a fixed local snapshot for seven synthetic trip invitees.</p><dl><div><dt>Who can answer</dt><dd>Demo trip invitees · Sign-in required in the real product</dd></div><div><dt>Notifications</dt><dd>None. No email or actual poll link is created.</dd></div></dl><div className={styles.actions}><button className={styles.primary} type="button" onClick={() => { dispatch({ type: "share" }); shareDialog.current?.close(); }}>Simulate sharing</button><button type="button" onClick={() => shareDialog.current?.close()}>Keep private</button></div></dialog>
  </>;
}

function Results({ round, quick, resolvedNeed }: { round: Round; quick: boolean; resolvedNeed?: string }) {
  const respondents = sampleAnswers.filter(answer => round.coverage === 7 || ["Robin", "Priya", "Nico"].includes(answer.name));
  const totals = (field: "firstDate" | "secondDate" | "sonoma" | "napa") => [...new Set(respondents.map(answer => answer[field]))].map(value => `${respondents.filter(answer => answer[field] === value).length} ${value}`).join(" · ");
  return <section className={styles.results}><h3>{round.coverage} of 7 answered</h3><p>{round.coverage < 7 ? "Still to answer: Maya, Jules, Dev and Tess." : "Everyone in this synthetic audience has answered."} Answers aren’t attendance or a group decision.</p>
    {quick ? <div className={styles.resultRows}><p><strong>A casual group dinner</strong><span>{respondents.filter(answer => answer.dinner === "A casual group dinner").length} prefer it</span></p><p><strong>Keep dinner flexible</strong><span>{respondents.filter(answer => answer.dinner === "Keep dinner flexible").length} prefer it</span></p><p className={styles.quiet}>A preference check only. No reservation or goal.</p></div> : round.number === 1 ? <div className={styles.resultRows}><p><strong>May 14–16</strong><span>{totals("firstDate")}</span></p><p><strong>May 20–22</strong><span>{totals("secondDate")}</span></p><p><strong>Sonoma</strong><span>{totals("sonoma")}</span></p><p><strong>Napa</strong><span>{totals("napa")}</span></p><p className={styles.notice}>Interest is not availability. These independent counts do not establish a date-and-place fit.</p>{round.coverage === 7 ? <p className={styles.need}><strong>Need noted · Maya, Round 1</strong>“I can’t take Thursday off. I could arrive Friday evening.”</p> : null}</div> : <div className={styles.resultRows}><p><strong>May 14–16 · Sonoma</strong><span>{respondents.filter(answer => answer.firstCombination).length} selected as workable</span></p><p><strong>May 20–22 · Napa</strong><span>{respondents.filter(answer => answer.secondCombination).length} selected as workable</span></p><p><strong>None of these</strong><span>0 selected</span></p><p className={styles.need}><strong>{resolvedNeed ? "Organizer handling recorded" : "Earlier need still requires review"} · Maya, Round 1</strong>{resolvedNeed ?? "Friday-evening arrival must be accommodated before deciding."}</p></div>}
    <details className={styles.sources}><summary>Source details · Round {round.number} sample responses</summary><p>Seeded fixture for the exact displayed message and questions. No new vote was inferred from another round.</p>{respondents.map(answer => <div className={styles.sourceRow} key={answer.name}><strong>{answer.name}</strong><span>{quick ? answer.dinner : round.number === 1 ? `May 14–16: ${answer.firstDate} · May 20–22: ${answer.secondDate} · Sonoma: ${answer.sonoma} · Napa: ${answer.napa}${answer.need ? ` · Need: ${answer.need}` : ""}` : `May 14–16 · Sonoma: workable · May 20–22 · Napa: ${answer.secondCombination ? "workable" : "not selected"}`}</span></div>)}</details>
  </section>;
}
