'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { CommonsWordmark, CoordinatorMark } from '@commons/ui';
import { coordinatorPersonalities, type CoordinatorPersonalityId } from '@commons/contracts';
import { DEMO_KEY, sampleDescription, initialDemo, restoreDemo, beginConversation, propose, approveTopics, createDemo, recordDecision, scenarios, type DemoState, type Scenario } from '@/lib/coordinator-onboarding-demo';
import './coordinator-onboarding-prototype.css';

function Action({ label, onClick, primary = false, disabled = false }: { label: string; onClick: () => void; primary?: boolean; disabled?: boolean }) {
  return <button type="button" className={primary ? "ob-primary" : ""} onClick={onClick} disabled={disabled}>{label}</button>;
}

type Pane = 'board' | 'conversation' | 'material';
type Failure = 'none' | 'unavailable' | 'save' | 'conflict';
export function CoordinatorOnboardingPrototype() {
  const [s, set] = useState<DemoState>(initialDemo);
  const [loaded, setLoaded] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [pane, setPane] = useState<Pane>('conversation');
  const [failure, setFailure] = useState<Failure>('none');
  const [modal, setModal] = useState<'personalities' | 'decision' | 'menu' | null>(null);
  const [candidate, setCandidate] = useState<CoordinatorPersonalityId>('commons');
  const [decisionText, setDecisionText] = useState('October 16–19, 2026');
  const [draftText, setDraftText] = useState('Which October weekend could work for you?');
  const [material, setMaterial] = useState<'summary' | 'comparison' | 'draft'>('summary');
  const [boardHidden, hideBoard] = useState(false);
  const [materialHidden, hideMaterial] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { set(restoreDemo(localStorage.getItem(DEMO_KEY))); } catch { setStorageError(true); }
      setLoaded(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(DEMO_KEY, JSON.stringify(s)); } catch { queueMicrotask(() => setStorageError(true)); }
  }, [s, loaded]);
  useEffect(() => { if (modal) dialog.current?.showModal(); }, [modal]);
  useEffect(() => { if (loaded) heading.current?.focus(); }, [s.screen, loaded]);
  const persona = coordinatorPersonalities.find(p => p.id === s.personality)!;
  const current = s.topics.find(t => t.id === s.active);
  const traveler = s.scenario === 'traveler';
  function patch(partial: Partial<DemoState>) { set(old => ({ ...old, ...partial })); }
  function open(type: NonNullable<typeof modal>) { restoreFocus.current = document.activeElement as HTMLElement; setCandidate(s.personality); setModal(type); }
  function close() { dialog.current?.close(); setModal(null); restoreFocus.current?.focus(); }
  function reset(scenario: Scenario) { set(initialDemo(scenario)); setFailure('none'); setPane('conversation'); setMaterial('summary'); setDraftText('Which October weekend could work for you?'); hideBoard(false); hideMaterial(false); }
  function talk() { if (failure === 'unavailable') { patch({ notice: 'Your coordinator is unavailable. Continue setup or use Workspace directly; your text is retained.' }); return; } set(old => { const next = beginConversation(old); return next.proposed.length || next.created ? next : propose(next, next.description === sampleDescription && (next.facts === sampleDescription || next.facts === initialDemo().facts) ? 'dates' : 'unknown'); }); setPane('conversation'); }
  function save(action: (state: DemoState) => DemoState) {
    if (failure === 'save') { patch({ notice: 'Couldn’t save. Your changes are still here. Clear the simulated failure and retry.' }); return; }
    if (failure === 'conflict') { set(old => ({ ...old, revision: old.revision + 1, notice: 'Alex’s co-organizer changed the trip. Review the latest version before applying.' })); return; }
    set(old => old.baseRevision !== old.revision ? { ...old, notice: 'Review the latest version before applying.' } : action(old));
  }
  function guided(focus: 'dates' | 'stay' | 'budget' | 'unknown') {
    if (failure === 'unavailable') { patch({ notice: 'Your coordinator is unavailable. Your text is safe. Continue manually or try again.' }); return; }
    const replies = { dates: 'Let’s find dates first.', stay: 'Let’s start with somewhere to stay.', budget: 'Let’s work out a budget.', unknown: 'I don’t know yet.' };
    const voice = { commons: 'Start with one question for the group. You can review the suggested topic before adding it.', joan: 'One manageable step is enough. Review the suggested topic; the other details can wait.', becky: 'Let’s give the group one clear place to contribute. Review the suggested topic before adding it.', miles: 'Pick one open decision and move it forward. Review this topic first; leave the rest for later.' };
    set(old => propose({ ...old, engaged: true, messages: [...old.messages, { author: 'Alex · organizer', text: replies[focus] }, { author: `${persona.name} · Commons AI`, text: voice[old.personality] }], notice: '' }, focus));
  }
  function sendNote() {
    if (!s.input.trim()) return;
    if (failure === 'unavailable') { patch({ notice: 'Your coordinator is unavailable. Your text is safe. Continue manually or try again.' }); return; }
    patch({ engaged: true, messages: [...s.messages, { author: 'Alex · organizer', text: s.input.trim() }], input: '', notice: 'Note saved in this demo. No AI read it. Use a sample reply below to explore a proposed next step.' });
  }
  function draftQuestion() { return s.active === 'stay' ? 'Would you prefer a shared house or separate rooms at a lodge?' : s.active === 'budget' ? 'What should our shared trip budget include?' : s.active === 'dates' ? 'Which October weekend could work for you?' : 'What would help us decide what comes first?'; }
  function comparison() { setMaterial('comparison'); setPane('material'); patch({ screen: 'workspace' }); }
  const identity = <div className="ob-identity"><CoordinatorMark /><span>{persona.name}{persona.name !== 'Commons' ? ' · Commons' : ''}<small>AI coordinator</small></span>{s.messages.length > 0 && <Action label={'Change'} onClick={() => open('personalities')} />}</div>;
  function summary() { return <><p className="ob-eyebrow">Trip context</p><h2>What we know</h2><p>{s.facts}</p><small>Source: {s.scenario === 'returning' ? 'sample trip records and Alex’s approved date decision' : 'sample description, reviewed by Alex'}.</small><h3>Next open question</h3><p>{current?.status !== 'Decided' && current ? current.title : 'Choose the next question when you’re ready. No new facts have been inferred from your edits.'}</p>{s.decision && <div className="ob-note"><strong>Approved decision</strong><p>{s.decision}</p></div>}</>; }
  function conversation() { return <>
    {identity}
    <p className="ob-caption">{s.created ? 'Visible to active trip organizers.' : 'Private setup draft. If you create this trip, this conversation will be shared with its organizers.'}</p>
    <div className="ob-messages" aria-label="Organizer conversation">
      {s.messages.length ? s.messages.filter((_, index) => s.created || index > 0).map((message, i) => <article className={message.author.startsWith('Alex') ? 'ob-human' : 'ob-ai'} key={i}><strong>{message.author}</strong><p>{message.text}</p></article>) : <div className="ob-empty"><CoordinatorMark /><h2>{s.decision ? 'Talk through what’s next.' : 'A little help getting started.'}</h2><p>{s.decision ? s.decision : 'Use the coordinator entry above when you want to talk it through.'}</p></div>}
    </div>
    {s.messages.length > 0 && <>
      {s.created && <div className="ob-samples"><small>Sample next action · authored demo</small><div className="ob-actions">{s.scenario === 'returning' ? <Action label="Compare the saved stays" onClick={comparison} /> : s.scenario === 'poll' && !s.decision ? <Action label="Review the date decision" onClick={() => open('decision')} /> : <Action label="Explore a starting point" onClick={() => set(old => propose(old, 'unknown'))} />}</div></div>}
      <form className="ob-composer" onSubmit={e => { e.preventDefault(); sendNote(); }}><label htmlFor="ob-note">Your note <small>Saved as text; no live AI response</small></label><div><textarea id="ob-note" rows={2} maxLength={2000} placeholder="What are you thinking?" value={s.input} onChange={e => patch({ input: e.target.value })} /><button aria-label="Save note" disabled={!s.input.trim()}>↑</button></div></form>
    </>}
  </>; }
  function startingPoint() {
    const topic = s.proposed[0];
    if (!topic) return null;
    return <section className="ob-starting-point"><p className="ob-eyebrow">Suggested next step</p><h2>{topic.title}</h2><p>{topic.id === 'dates' ? 'For the sample brief, agreeing on dates will help narrow the stay search.' : topic.id === 'stay' ? 'Compare what matters in a place before choosing one.' : topic.id === 'budget' ? 'Agree on what the budget covers before assuming a comfortable amount.' : 'Start with one open question; the other details can wait.'}</p>
      <details><summary>Change the starting point</summary><label>Topic title<input value={topic.title} onChange={e => patch({ staged: false, proposed: [{ ...topic, title: e.target.value }] })} /></label><div className="ob-actions"><Action label="Dates" onClick={() => guided('dates')} /><Action label="Stay" onClick={() => guided('stay')} /><Action label="Budget" onClick={() => guided('budget')} /><Action label="Something else" onClick={() => guided('unknown')} /></div></details>
      <p className="ob-caption">{s.created ? 'Adds one organizer topic. No poll is published or sent.' : 'Select this for your setup draft. It becomes an organizer topic only when you create the trip.'}</p>
      <Action label={s.staged ? 'Starting point selected' : s.created ? 'Add this starting topic' : 'Use this starting point'} onClick={() => save(approveTopics)} disabled={s.staged || !topic.title.trim()} />
    </section>;
  }
  function working(): ReactNode {
    if (s.scenario === 'poll' && !s.decision) return <><p className="ob-eyebrow">Sample poll · waiting for responses</p><h2>A leading option, not a decision.</h2><div className="ob-vote"><span>October 16–19</span><strong>3 votes</strong></div><div className="ob-vote"><span>October 23–26</span><strong>1 vote</strong></div><p>4 of 6 people responded. Two haven’t replied.</p><p>Votes are sample records, not conversation history. Missing replies don’t imply agreement.</p>{<Action label={'Review decision'} onClick={() => open('decision')} primary={true} />}{<Action label={'Keep waiting'} onClick={() => patch({ notice: 'The poll remains open. No decision was recorded.' })} />}</>;
    if (material === 'comparison') return <><p className="ob-eyebrow">Saved options · sample evidence</p><h2>Two ways to stay.</h2><div className="ob-evidence"><h3>A house together</h3><p>Space to cook and spend evenings together. Bedroom setup and total cost are unknown.</p><small>Source: Alex’s sample saved idea · September 24, 2026.</small></div><div className="ob-evidence"><h3>Rooms at a lodge</h3><p>More separate space. A shared kitchen has not been confirmed.</p><small>Source: Sam’s sample saved idea · September 24, 2026.</small></div><p>No properties, prices, or availability have been researched. These are accommodation approaches.</p>{<Action label={'Prepare a preference poll'} onClick={() => { setDraftText('Would you prefer a shared house or separate rooms at a lodge?'); setMaterial('draft'); }} primary={true} />}</>;
    if (material === 'draft') return <><p className="ob-eyebrow">Suggested edit · organizers only</p><h2>One question for the group.</h2><label>Poll question<textarea value={draftText} onChange={e => setDraftText(e.target.value)} /></label><p>{s.active === 'stay' ? 'Options: Shared house · Lodge rooms · No preference' : s.active === 'dates' ? 'Options to review: October 16–19 · October 23–26 · Neither' : 'Open response. Ask the group before assuming priorities or a budget ceiling.'}</p><p>Based on {s.active === 'stay' ? 'the two sample saved ideas' : 'the sample brief; review suggested options against your actual details'}.</p>{<Action label={'Apply to draft'} onClick={() => save(old => ({ ...old, draft: draftText.trim(), topics: old.topics.map(t => t.id === old.active ? { ...t, status: 'Draft' } : t), notice: 'Draft saved for organizers. It has not been published or sent.' }))} primary={true} disabled={!draftText.trim()} />}{s.draft && <div className="ob-note"><strong>Saved draft</strong><p>{s.draft}</p>{<Action label={'Undo saved draft'} onClick={() => patch({ draft: '', topics: s.topics.map(t => t.id === s.active ? { ...t, status: 'Exploring' } : t), notice: 'Draft removed. Nothing was published.' })} />}</div>}<p className="ob-caption">Publishing and sharing are outside this prototype.</p></>;
    return <>{summary()}{current && current.status !== 'Decided' && <div className="ob-actions">{<Action label={current.id === 'stay' ? 'Compare saved options' : 'Prepare a poll draft'} onClick={() => { setDraftText(draftQuestion()); setMaterial(current.id === 'stay' ? 'comparison' : 'draft'); setPane('material'); }} primary={true} />}</div>}</>;
  }
  if (!loaded) return <main className="ob-demo"><p role="status">Loading your local demo…</p></main>;
  return <div className="ob-demo">
    <aside className="ob-reviewer" aria-label="Prototype review controls"><details><summary>Prototype review · sample data, authored replies</summary><div className="ob-review-controls"><label>Scenario<select value={s.scenario} onChange={e => reset(e.target.value as Scenario)}>{scenarios.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label><label>Simulate a failure<select value={failure} onChange={e => setFailure(e.target.value as Failure)}><option value="none">None</option><option value="unavailable">Coordinator unavailable</option><option value="save">Save fails</option><option value="conflict">Another organizer edits</option></select></label>{<Action label={'Reset demo'} onClick={() => reset(s.scenario)} />}<Link href="/prototype/coordinator-personalities/">Compare coordinator voices</Link><p>Only this browser’s sample state changes. Use synthetic details. Scenario selection resets the journey. No real trip, model, research, or delivery is connected.</p></div></details></aside>
    <header className="ob-header"><CommonsWordmark /><span>{s.description === sampleDescription ? 'October in the mountains' : 'Your event'}{!s.created && <small>Private setup draft</small>}</span>{s.created && !traveler && <Action label={'Menu'} onClick={() => open('menu')} />}</header>
    {storageError && <p role="alert" className="ob-alert">Browser storage is unavailable. This demo works, but changes won’t survive a reload.</p>}
    <div className="ob-status" role="status">{s.notice}</div>
    {s.revision !== s.baseRevision && <div className="ob-alert"><p>The latest sample version contains a co-organizer update. Your proposed edits have not been applied.</p><p>Sam’s new note: check that the stay has a step-free entrance.</p>{<Action label={'Review latest version'} onClick={() => { patch({ facts: `${s.facts.replace(' · Step-free entrance needed', '')} · Step-free entrance needed`, baseRevision: s.revision, notice: 'Latest context loaded. Review your proposed changes, then apply again.' }); setFailure('none'); }} />}</div>}
    {traveler ? <main className="ob-setup"><p className="ob-eyebrow">Traveler view · sample</p><h1 ref={heading} tabIndex={-1}>Your October weekend.</h1><p>October 16–19, 2026 · 6 friends</p><h2>Group decision</h2><p>{s.decision}</p><p>The itinerary is still open. Your organizers are working on where to stay.</p><p className="ob-caption">Organizer Workspace and its notes are not part of this traveler view.</p></main> : <>
      {s.screen === 'describe' && <main className="ob-setup"><p className="ob-eyebrow">Start an event</p><h1 ref={heading} tabIndex={-1}>What are you planning?</h1><p>Start with the people, the place, or just the idea.</p><label>Your event description<textarea rows={5} value={s.description} maxLength={2000} onChange={e => patch({ description: e.target.value })} /></label><p className="ob-caption">This preview starts with an October weekend example. Edits are retained as your notes; the sample facts on the next screen are editable, not AI-extracted.</p>{<Action label={'Review sample setup'} onClick={() => patch({ screen: 'setup', facts: s.description, messages: [], proposed: [], staged: false, helpOpen: false })} primary={true} disabled={!s.description.trim()} />}</main>}
      {s.screen === 'setup' && <main className="ob-setup"><p className="ob-eyebrow">Review your event</p><h1 ref={heading} tabIndex={-1}>A place to start.</h1><details><summary>Your original description</summary><p>{s.description}</p></details><label>Known details<textarea value={s.facts} onChange={e => patch({ facts: e.target.value })} /></label><p className="ob-caption">Reviewed by you. This demo keeps your words; it does not extract facts with AI.</p>
        <section className="ob-invitation">
          {!s.helpOpen ? s.staged ? <Action label="Keep talking" onClick={talk} /> : <><h2>A little help with the next step.</h2><p>Talk through the open questions with {persona.name}, or create your trip now.</p><Action label="Talk it through" onClick={talk} /></> : <>{conversation()}{startingPoint()}<Action label="Close coordinator help" onClick={() => patch({ helpOpen: false })} /></>}
          {!s.messages.length && <button className="ob-quiet" onClick={() => open('personalities')}>Meet other coordinators</button>}
        </section>
        <h2>Ready to create?</h2><p>No recipients added. No invitations will be sent.</p>
        {s.staged && <div className="ob-note"><strong>Selected starting point: {s.proposed[0]?.title}</strong><p>This organizer topic will be added with the trip.</p><Action label="Remove starting point" onClick={() => patch({ staged: false })} /></div>}
        {s.messages.length > 0 && <p>This starting conversation will be visible to active trip organizers after creation.</p>}
        <div className="ob-actions"><Action label={s.staged ? 'Create trip with this starting point' : 'Create sample trip without sending'} onClick={() => save(createDemo)} primary /><Action label="Back to description" onClick={() => patch({ screen: 'describe' })} /></div>
      </main>}
      {s.screen === 'workspace' && <main className="ob-workspace"><div className="ob-workspace-title"><div><p className="ob-eyebrow">Organizer Workspace</p><h1 ref={heading} tabIndex={-1}>{current?.title ?? 'Room to make a plan.'}</h1></div>{<Action label={`Talk to ${persona.name}`} onClick={talk} />}</div>
        {!s.dismissed && !s.engaged && !s.topics.length && <section className="ob-return-invite"><div><h2>Want help getting started?</h2><p>Pick up your idea with {persona.name}, or start a topic yourself.</p></div><div className="ob-actions">{<Action label={'Dismiss invitation'} onClick={() => patch({ dismissed: true, notice: 'Invitation dismissed for Alex on this sample trip. Your coordinator is still available.' })} />}</div></section>}
        <nav className="ob-pane-tabs" aria-label="Workspace views">{(['board', 'conversation', 'material'] as const).map(p => <button key={p} aria-pressed={pane === p} onClick={() => setPane(p)}>{p === 'board' ? 'Trip board' : p === 'conversation' ? 'Conversation' : material === 'comparison' ? 'Research' : 'Working draft'}</button>)}</nav>
        <div className={`ob-columns ${boardHidden ? 'ob-board-hidden' : ''} ${materialHidden ? 'ob-material-hidden' : ''}`}>
          <aside className={`ob-board ob-pane ${pane === 'board' ? 'ob-active-pane' : ''}`}><div className="ob-expanded"><div className="ob-pane-heading"><h2>Trip board</h2><button className="ob-collapse" onClick={() => hideBoard(true)} aria-label="Collapse Trip board">←</button></div>{s.topics.length ? s.topics.map(t => <button className="ob-topic" key={t.id} aria-pressed={s.active === t.id} onClick={() => { patch({ active: t.id }); setMaterial('summary'); setPane('conversation'); }}><strong>{t.title}</strong><span>{t.status}{s.active === t.id ? ' · Selected' : ''}</span></button>) : <p>No topics yet.</p>}{<Action label={'Start something new'} onClick={() => set(old => propose(old, 'unknown'))} />}{current && <Action label={'Remove selected topic'} onClick={() => patch({ topics: s.topics.filter(t => t.id !== s.active), active: '', notice: 'Topic removed from this demo. No poll or shared plan changed.' })} />}</div><button className="ob-restore" onClick={() => hideBoard(false)} aria-label="Restore Trip board">→</button></aside>
          <section className={`ob-chat ob-pane ${pane === 'conversation' ? 'ob-active-pane' : ''}`}>{s.helpOpen ? <>{conversation()}{startingPoint()}<Action label="Close conversation" onClick={() => patch({ helpOpen: false })} /></> : <p>Continue with your coordinator using the entry above. Your conversation and unsent text stay here.</p>}</section>
          <aside className={`ob-material ob-pane ${pane === 'material' ? 'ob-active-pane' : ''}`}><div className="ob-expanded"><button className="ob-collapse" onClick={() => hideMaterial(true)} aria-label="Collapse working material">→</button>{working()}</div><button className="ob-restore" onClick={() => hideMaterial(false)} aria-label="Restore working material">←</button></aside>
        </div>
      </main>}
    </>}
    {modal && <dialog ref={dialog} className="ob-dialog" aria-labelledby="ob-dialog-title" onCancel={e => { e.preventDefault(); close(); }}><div className="ob-dialog-top"><h2 id="ob-dialog-title">{modal === 'personalities' ? 'Meet your coordinator.' : modal === 'decision' ? 'Review the date decision.' : 'Trip menu'}</h2>{<Action label={'Close'} onClick={close} />}</div>
      {modal === 'personalities' && <><p>Different planning styles. The same Commons tools, facts, and approvals.</p><fieldset><legend>Choose a Commons AI coordinator</legend>{coordinatorPersonalities.map(p => <label className="ob-persona" key={p.id}><span><input type="radio" name="personality" checked={candidate === p.id} onChange={() => setCandidate(p.id)} /><strong>{p.name}</strong>{s.personality === p.id && <small>Current</small>}</span><span>{p.description}</span><small>{p.habit}</small></label>)}</fieldset><div className="ob-note"><strong>One sample · dates still open</strong><p>{({ commons: 'Let’s ask which October weekend works before comparing stays.', joan: 'We can make this manageable: ask about October weekends first, then look at stays.', becky: 'Let’s give everyone a say on the October weekend, then find a place to come together.', miles: 'Settle the October weekend first. Then the stay search has a useful constraint.' })[candidate]}</p></div><p>This changes future replies for all organizers of this trip. Earlier messages and decisions stay as they are.</p>{<Action label={`Choose ${coordinatorPersonalities.find(p => p.id === candidate)!.name}`} onClick={() => { patch({ personality: candidate, notice: 'Coordinator changed for this sample trip. Future replies use the new style.' }); close(); }} primary={true} />}</>}
      {modal === 'decision' && <><p>October 16–19 leads, with 3 of 4 responses. Two people have not replied.</p><label>Decision to record<input value={decisionText} maxLength={200} onChange={e => setDecisionText(e.target.value)} /></label><p>Record this as Alex’s decision for the group. It does not claim unanimous agreement, close the poll, send a message, or add anything to Plan.</p>{<Action label={'Record decision for the group'} onClick={() => { save(old => recordDecision(old, decisionText)); close(); }} primary={true} disabled={!decisionText.trim()} />}{<Action label={'Wait for more responses'} onClick={close} />}</>}
      {modal === 'menu' && <><p>{s.description === sampleDescription ? 'October in the mountains' : 'Your event'} · Alex, organizer</p>{<Action label={'Workspace'} onClick={() => { patch({ screen: 'workspace' }); close(); }} />}{<Action label={'Trip settings · Coordinator'} onClick={() => setModal('personalities')} />}<p className="ob-caption">This review includes Workspace and coordinator settings. Home, Plan, Money, and Photos remain in the production trip navigation and are outside this local demo.</p></>}
    </dialog>}
  </div>;
}
