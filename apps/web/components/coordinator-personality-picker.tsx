'use client';
import { trackProductEvent } from '@/lib/product-analytics';
import { useEffect, useRef, useState } from 'react';
import { coordinatorPersonalities, type CoordinatorPersonalityId } from '@commons/contracts';
import { personalityExamples, personalityScenario } from '../lib/coordinator-personality-examples';
export function CoordinatorPersonalityPicker({ value, onChoose, disabled = false, triggerLabel = "Meet other coordinators" }: {
    value: CoordinatorPersonalityId;
    onChoose: (id: CoordinatorPersonalityId) => Promise<void>;
    disabled?: boolean;
    triggerLabel?: string;
}) {
    const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null);
    const [candidate, setCandidate] = useState(value), [error, setError] = useState(''), [saving, setSaving] = useState(false);
    useEffect(() => { const close = () => requestAnimationFrame(() => trigger.current?.focus()); const el = dialog.current; el?.addEventListener('close', close); return () => el?.removeEventListener('close', close); }, []);
    return <><button ref={trigger} type="button" className="cm-action" disabled={disabled} onClick={() => { setCandidate(value); setError(''); dialog.current?.showModal(); }}>{triggerLabel}</button><dialog onKeyDown={event => {
        if (event.key !== 'Tab') return;
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input[type="radio"]:checked:not(:disabled), summary, a[href]')).filter(element => element.getClientRects().length);
        if (!controls.length) return;
        const index = controls.indexOf(document.activeElement as HTMLElement);
        event.preventDefault();
        controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length].focus();
    }} onCancel={event => { if (saving) event.preventDefault(); }} ref={dialog} className="coordinator-choice-dialog" aria-labelledby="coordinator-choice-title"><header><h2 id="coordinator-choice-title">Your Commons coordinator</h2><button type="button" className="cm-action" disabled={saving} onClick={() => dialog.current?.close()}>Close</button></header><p>AI planning styles with the same tools and approval rules. Changes apply to future replies for this trip’s organizers.</p><fieldset disabled={saving}><legend>Choose a style</legend>{coordinatorPersonalities.map(person => <label key={person.id} htmlFor={`coordinator-choice-${person.id}`} aria-label={person.name}><input aria-label={person.name} id={`coordinator-choice-${person.id}`} type="radio" name="coordinator-choice" checked={candidate === person.id} onChange={() => setCandidate(person.id)}/><span><strong>{person.name}</strong><span>{person.description}</span><small>{person.habit}</small></span></label>)}</fieldset><details><summary>Compare a sample reply</summary><p>{personalityScenario.brief}</p><blockquote>{personalityExamples[candidate]}</blockquote><small>Written example of this style, not a live AI reply.</small></details>{error && <p role="alert">{error}</p>}<button type="button" className="cm-action cm-action--primary" disabled={saving} onClick={async () => { setSaving(true); try {
        await onChoose(candidate);
        trackProductEvent("coordinator_selected", { properties: { personality: candidate } });
        dialog.current?.close();
    }
    catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not save.');
    }
    finally {
        setSaving(false);
    } }}>{saving ? 'Saving…' : `Choose ${coordinatorPersonalities.find(p => p.id === candidate)!.name}`}</button></dialog></>;
}
