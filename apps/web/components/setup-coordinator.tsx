'use client';
import { trackProductEvent } from '@/lib/product-analytics';
import { useEffect, useRef, useState } from 'react';
import { EventCreationDraftSchema, coordinatorPersonalities, type EventCreationDraft, type CoordinatorPersonalityId } from '@commons/contracts';
import { CoordinatorMark } from '@commons/ui';
import { CoordinatorPersonalityPicker } from './coordinator-personality-picker';
export function SetupCoordinator({ draft, onChange, onBusy, disabled, personalitiesEnabled = false }: {
  /** The coordinator style picker; paused by default. */ personalitiesEnabled?: boolean;
    draft: EventCreationDraft;
    onChange: (draft: EventCreationDraft) => void;
    onBusy: (busy: boolean) => void;
    disabled: boolean;
}) {
    const [open, setOpen] = useState(false), [prompt, setPrompt] = useState(''), [error, setError] = useState('');
    const [title, setTitle] = useState((draft.coordinator.startingPoint ?? draft.brief.suggestedFirstMoves[0] ?? (!draft.startsOn ? 'Find dates' : 'Work out what comes next')).slice(0, 120));
    const [command, setCommand] = useState<{
        id: string;
        prompt: string;
    } | null>(null);
    const opener = useRef<HTMLButtonElement>(null);
    const composer = useRef<HTMLTextAreaElement>(null);
    function showConversation(next: boolean) {
        setOpen(next);
        if (next) trackProductEvent("coordinator_setup_opened", { properties: { surface: "setup" } });
        requestAnimationFrame(() => (next ? composer.current : opener.current)?.focus());
    }
    const [restored, setRestored] = useState(false);
    useEffect(() => { const frame = requestAnimationFrame(() => { try {
        setPrompt(sessionStorage.getItem(`commons-setup-text:${draft.id}`) ?? '');
            const savedTitle = sessionStorage.getItem(`commons-setup-topic:${draft.id}`);
            if (savedTitle !== null) setTitle(savedTitle);
    }
    catch { /* Browser storage is optional. */ } setRestored(true); }); return () => cancelAnimationFrame(frame); }, [draft.id]);
    useEffect(() => { if (restored) {
        try {
            sessionStorage.setItem(`commons-setup-text:${draft.id}`, prompt);
                sessionStorage.setItem(`commons-setup-topic:${draft.id}`, title);
        }
        catch { /* Browser storage is optional. */ }
    } }, [draft.id, prompt, title, restored]);
    const person = coordinatorPersonalities.find(p => p.id === draft.coordinator.personality.id)!;
    async function change(body: object) {
        onBusy(true);
        setError('');
        try {
            const response = await fetch(`/api/v1/event-creation-drafts/${draft.id}/coordinator`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedVersion: draft.version, ...body }) });
            const payload = await response.json();
            if (!response.ok)
                throw new Error(payload.error ?? 'Could not save your coordinator work.');
            const next = EventCreationDraftSchema.parse(payload.draft);
            onChange(next);
            return next;
        }
        catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Could not save.');
            throw cause;
        }
        finally {
            onBusy(false);
        }
    }
    async function configure(id: CoordinatorPersonalityId, startingPoint: string | null) { await change({ action: 'configure', personality: { id, specificationVersion: 1 }, startingPoint }); if (startingPoint !== null) trackProductEvent('coordinator_topic_selected', { properties: { surface: 'setup' } }); }
    async function send() { const text = prompt.trim() || 'Using the saved event details, recommend one useful next step. Ask only if a missing answer changes that step.'; const request = command?.prompt === text ? command : { id: crypto.randomUUID(), prompt: text }; setCommand(request); try {
        await change({ action: 'message', commandId: request.id, prompt: text });
        trackProductEvent('coordinator_reply_received', { properties: { surface: 'setup', personality: person.id } });
        setPrompt('');
        setCommand(null);
    }
    catch { trackProductEvent("coordinator_reply_failed", { properties: { surface: "setup" } }); /* Text and command remain available for retry. */ } }
    return <section className="setup-coordinator" aria-label="Get started with your coordinator"><div className="setup-coordinator-heading"><CoordinatorMark /><h3>{draft.coordinator.startingPoint ? 'Your starting point' : 'A little help with the next step'}</h3></div>
 {draft.coordinator.startingPoint && <p><strong>{draft.coordinator.startingPoint}</strong> will become one organizer Workspace topic when you create this event.</p>}
 <div className="setup-coordinator-entry-actions"><button type="button" className="cm-action" disabled={disabled} ref={opener} onClick={() => showConversation(true)}>Talk it Through</button>{personalitiesEnabled ? <CoordinatorPersonalityPicker triggerLabel="Pick your coordinator" value={person.id} disabled={disabled} onChoose={id => configure(id, draft.coordinator.startingPoint)}/> : null}</div>
 {open && <>
 <p className="review-caption">This is your private setup conversation. If you select a starting topic, completed replies will be shared with that trip’s active organizers when you create it.</p>
 <div className="setup-coordinator-history" role="log" aria-live="polite">{draft.coordinator.turns.map(turn => <article key={turn.commandId}><strong>You</strong><p>{turn.prompt}</p><strong>{coordinatorPersonalities.find(p => p.id === turn.personality.id)!.name} · Commons AI</strong><p>{turn.reply ?? 'This reply is unfinished. Reload to check its status; after a minute you can send a new message or continue setup.'}</p></article>)}</div>
 <label>What’s on your mind?<textarea ref={composer} value={prompt} maxLength={1800} rows={3} onChange={e => setPrompt(e.target.value)} disabled={disabled}/></label>
 <div className="setup-coordinator-actions"><button type="button" className="cm-action" disabled={disabled} onClick={() => void send()}>{disabled ? 'Working…' : prompt.trim() ? 'Ask your coordinator' : 'Suggest a next step'}</button><button type="button" className="cm-action" disabled={disabled} onClick={() => showConversation(false)}>Close conversation</button></div>
 <h4>One starting point</h4><p>Use a suggested first move or name the question you want to work on. Nothing is published or sent.</p><label>Starting topic<input value={title} maxLength={120} onChange={e => setTitle(e.target.value)} disabled={disabled}/></label>
 <button type="button" className="cm-action" disabled={disabled || !title.trim()} onClick={() => void configure(person.id, title.trim()).then(() => showConversation(false)).catch(() => { })}>Use this starting point</button>
 </>}
 {draft.coordinator.startingPoint && <button type="button" className="cm-action" disabled={disabled} onClick={() => void configure(person.id, null).catch(() => { })}>Remove starting point</button>}
 {error && <div role="alert"><p>{error}</p><button type="button" className="cm-action" disabled={disabled} onClick={async () => { try {
        const response = await fetch(`/api/v1/event-creation-drafts/${draft.id}`, { cache: 'no-store' });
        if (!response.ok)
            throw new Error('Could not reload.');
        onChange(EventCreationDraftSchema.parse((await response.json()).draft));
        setError('');
        setCommand(null);
    }
    catch {
        setError('Could not reload. Your text is still here.');
    } }}>Reload latest setup</button></div>}
 </section>;
}
