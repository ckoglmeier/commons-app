import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { participantOptionDetails, shortlistError, syncDecisionOptions, type ItineraryContent, type ItineraryDraft } from '@commons/contracts';
import { syntheticDraft } from '../../../packages/contracts/src/fixtures/research-itinerary';
import { createHookRenderer, registerComponentImportStubs, textOf, type HostNode, type OpaqueNode } from '../lib/test-support/hook-harness';
registerComponentImportStubs();

type Item = ItineraryContent['items'][number];
type Decision = NonNullable<Item['decision']>;
type Node = HostNode | OpaqueNode;

// Committed, shortened Sonoma captures: Schramsberg is unsuitable for nine on a Friday.
const saved = JSON.parse(readFileSync(fileURLToPath(new URL('../../../docs/releases/2026-10-19/evidence/sonoma-saved-state.json', import.meta.url)), 'utf8'));
const evidence: ItineraryDraft['evidence'] = saved.research.sources.map((row: ItineraryDraft['evidence'][number]) => ({ runId: row.runId, sourceId: row.sourceId, title: row.title, url: row.url, excerpt: row.excerpt, retrievedAt: row.retrievedAt }));
const CHOICES = ['Schramsberg Vineyards', 'Flowers Vineyards & Winery', 'DaVero Farms & Winery'];

function makeItem(decision: Decision | null = { question: 'Which winery?', options: CHOICES }): Item {
  const base = syntheticDraft().content.items[0];
  return { ...base, id: 'friday-winery', title: 'Friday winery', kind: 'activity', day: '2026-11-06', partySize: 9, location: 'Sonoma',
    sources: evidence.map(row => ({ runId: row.runId, sourceId: row.sourceId })), decision } as Item;
}

async function setup(item: Item, disabled = false, extra: Record<string, unknown> = {}) {
  const emitted: Decision[] = [];
  let current = item;
  const { ItineraryShortlistEditor } = await import('./itinerary-shortlist-editor');
  const renderer = createHookRenderer({ expand: [ItineraryShortlistEditor] });
  const draw = () => renderer.render(createElement(ItineraryShortlistEditor, { item: current, evidence, disabled, ...extra, onChange: decision => { emitted.push(decision); } }));
  draw();
  return {
    renderer, emitted, draw,
    // Re-render with the parent's applied change, as the lead's autosave would.
    apply(decision: Decision) { current = { ...current, decision }; draw(); renderer.flush(); },
    button: (name: string) => renderer.find(n => n.type === 'button' && textOf(n) === name),
    byLabel: (label: string) => renderer.find(n => n.props['aria-label'] === label),
    text: () => renderer.tree.map(textOf).join(' '),
  };
}
const press = (node: Node) => (node.props.onClick as () => void)();
const change = (node: Node, value: string | boolean) => (node.props.onChange as (e: unknown) => void)({ target: typeof value === 'boolean' ? { checked: value } : { value } });

async function compared() {
  const ctx = await setup(makeItem());
  press(ctx.button('Compare these options'));
  const decision = ctx.emitted[0];
  ctx.apply(decision);
  return { ...ctx, decision };
}

test('Compare these options emits a valid shortlist and never asks about unsuitable options', async () => {
  const ctx = await setup(makeItem());
  try {
    assert.match(ctx.text(), /Nothing is booked, assigned or shared until you approve it/);
    press(ctx.button('Compare these options'));
    assert.equal(ctx.emitted.length, 1);
    const decision = ctx.emitted[0];
    assert.equal(shortlistError(decision), null);
    assert.equal(decision.chosenOptionId, null);
    const schramsberg = decision.shortlist!.find(option => option.label === 'Schramsberg Vineyards')!;
    assert.equal(schramsberg.fit, 'unsuitable');
    assert.equal(schramsberg.inPoll, false);
    assert.deepEqual(decision.options, syncDecisionOptions(decision.shortlist!));
    assert.deepEqual(decision.options, ['Flowers Vineyards & Winery', 'DaVero Farms & Winery']);
  } finally { ctx.renderer.unmount(); }
});

test('fewer than two askable options after comparing emits nothing and says why', async () => {
  const ctx = await setup(makeItem({ question: 'Which winery?', options: ['Schramsberg Vineyards', 'Flowers Vineyards & Winery'] }));
  try {
    press(ctx.button('Compare these options')); ctx.renderer.flush();
    assert.equal(ctx.emitted.length, 0);
    assert.match(ctx.text(), /At least two options must be suitable/);
  } finally { ctx.renderer.unmount(); }
});

test('keep, note and ask edits preserve ids and other options; cannot ask fewer than two', async () => {
  const ctx = await compared();
  try {
    const before = ctx.decision.shortlist!, flowers = before[1], davero = before[2];
    const rendered = ctx.text();
    assert.match(rendered, /Not suitable for this stop/);
    assert.match(rendered, /Still to confirm:/);
    assert.match(rendered, /\(supplier page\)/);
    assert.match(rendered, /\(secondary source\)/);
    assert.match(rendered, /Organizers only/);
    // Unsuitable: ask checkbox disabled, no choose button.
    assert.equal(ctx.byLabel('Ask the group about Schramsberg Vineyards').props.disabled, true);
    assert.equal(ctx.renderer.findAll(n => n.props['aria-label'] === 'Choose Schramsberg Vineyards').length, 0);
    // Exactly two asked: neither can be unchecked.
    assert.equal(ctx.byLabel(`Ask the group about ${flowers.label}`).props.disabled, true);
    assert.equal(ctx.byLabel(`Ask the group about ${davero.label}`).props.disabled, true);

    const start = ctx.emitted.length;
    change(ctx.byLabel(`Private note for ${flowers.label}`), 'Call about Friday');
    change(ctx.byLabel(`Keep ${davero.label} when refining`), true);
    assert.equal(ctx.emitted.length, start + 2);
    const afterNote = ctx.emitted[start], afterKeep = ctx.emitted[start + 1];
    assert.equal(afterNote.shortlist![1].note, 'Call about Friday');
    assert.deepEqual(afterNote.shortlist!.map(option => option.id), before.map(option => option.id));
    // The second edit was made against the same props (parent had not re-rendered): only keep changed.
    assert.equal(afterKeep.shortlist![2].keep, true);
    assert.equal(afterKeep.shortlist![1].note, '');
    for (const decision of ctx.emitted) assert.equal(shortlistError(decision), null);

    // Applying the first edit keeps its note while another is typed.
    ctx.apply(afterNote);
    change(ctx.byLabel(`Private note for ${flowers.label}`), 'Call about Friday!');
    assert.equal(ctx.emitted.at(-1)!.shortlist![1].note, 'Call about Friday!');
    assert.equal(ctx.emitted.at(-1)!.shortlist![2].keep, false);
  } finally { ctx.renderer.unmount(); }
});

test('asking a third option enables unchecking another and keeps decision.options in sync', async () => {
  const ctx = await compared();
  try {
    const first = ctx.decision.shortlist!;
    // Add a third askable option by editing shortlist through add + ask.
    const open = ctx.renderer.find(n => n.type === 'input' && n.props.type === 'text');
    change(open, 'Kenwood Cellars'); ctx.renderer.flush();
    press(ctx.button('Add option'));
    const added = ctx.emitted.at(-1)!;
    assert.equal(shortlistError(added), null);
    ctx.apply(added);
    const newOption = added.shortlist!.find(option => option.label === 'Kenwood Cellars')!;
    change(ctx.byLabel(`Ask the group about ${newOption.label}`), true);
    const asked = ctx.emitted.at(-1)!;
    assert.deepEqual(asked.options, ['Flowers Vineyards & Winery', 'DaVero Farms & Winery', 'Kenwood Cellars']);
    ctx.apply(asked);
    assert.equal(ctx.byLabel(`Ask the group about ${first[1].label}`).props.disabled, false);
    change(ctx.byLabel(`Ask the group about ${first[1].label}`), false);
    assert.equal(shortlistError(ctx.emitted.at(-1)!), null);
    assert.deepEqual(ctx.emitted.at(-1)!.options, ['DaVero Farms & Winery', 'Kenwood Cellars']);
  } finally { ctx.renderer.unmount(); }
});

test('choose then clear; unsuitable cannot be chosen; chosen cannot be removed; choosing leaves the poll untouched', async () => {
  const ctx = await compared();
  try {
    const flowers = ctx.decision.shortlist![1];
    press(ctx.byLabel(`Choose ${flowers.label}`));
    const chosen = ctx.emitted.at(-1)!;
    assert.equal(chosen.chosenOptionId, flowers.id);
    assert.deepEqual(chosen.options, ctx.decision.options);
    assert.deepEqual(chosen.shortlist!.map(option => option.inPoll), ctx.decision.shortlist!.map(option => option.inPoll));
    assert.equal(shortlistError(chosen), null);
    ctx.apply(chosen);
    assert.match(ctx.text(), /Chosen · not booked/);
    // Removing the chosen option is refused with a reason and nothing is emitted.
    const count = ctx.emitted.length;
    press(ctx.byLabel(`Remove ${flowers.label}`)); ctx.renderer.flush();
    assert.equal(ctx.emitted.length, count);
    assert.match(ctx.text(), /chosen option cannot be removed/);
    press(ctx.byLabel(`Clear choice of ${flowers.label}`));
    assert.equal(ctx.emitted.at(-1)!.chosenOptionId, null);
    assert.equal(shortlistError(ctx.emitted.at(-1)!), null);
  } finally { ctx.renderer.unmount(); }
});

test('removal is allowed when it leaves two asked, refused when it would leave fewer', async () => {
  const ctx = await compared();
  try {
    const [unsuitable, flowers] = ctx.decision.shortlist!;
    const count = ctx.emitted.length;
    press(ctx.byLabel(`Remove ${flowers.label}`)); ctx.renderer.flush();
    assert.equal(ctx.emitted.length, count);
    assert.match(ctx.text(), /At least two options must stay/);
    press(ctx.byLabel(`Remove ${unsuitable.label}`));
    const removed = ctx.emitted.at(-1)!;
    assert.equal(shortlistError(removed), null);
    assert.deepEqual(removed.shortlist!.map(option => option.label), ['Flowers Vineyards & Winery', 'DaVero Farms & Winery']);
  } finally { ctx.renderer.unmount(); }
});

test('adding an option rejects case-insensitive duplicates and does not ask the group by default', async () => {
  const ctx = await compared();
  try {
    const input = () => ctx.renderer.find(n => n.type === 'input' && n.props.type === 'text');
    change(input(), 'davero farms & winery'); ctx.renderer.flush();
    const count = ctx.emitted.length;
    press(ctx.button('Add option')); ctx.renderer.flush();
    assert.equal(ctx.emitted.length, count);
    assert.match(ctx.text(), /already an option/);
    change(input(), '  Kenwood Cellars '); ctx.renderer.flush();
    press(ctx.button('Add option'));
    const added = ctx.emitted.at(-1)!;
    const option = added.shortlist!.at(-1)!;
    assert.deepEqual({ label: option.label, fit: option.fit, inPoll: option.inPoll, keep: option.keep, note: option.note, unknowns: option.unknowns, planItemId: option.planItemId }, { label: 'Kenwood Cellars', fit: 'requires_confirmation', inPoll: false, keep: false, note: '', unknowns: ['Not researched'], planItemId: null });
    assert.equal(new Set(added.shortlist!.map(row => row.id)).size, added.shortlist!.length);
    assert.deepEqual(added.options, ctx.decision.options);
    assert.equal(shortlistError(added), null);
  } finally { ctx.renderer.unmount(); }
});

test('private notes and organizer reasons never reach participant option details', async () => {
  const ctx = await compared();
  try {
    const noted = { ...ctx.decision.shortlist![0], note: 'PRIVATE_NOTE: owner is difficult', reasons: ['PRIVATE_REASON'], unknowns: ['PRIVATE_UNKNOWN'] };
    const details = participantOptionDetails(noted);
    assert.doesNotMatch(details, /PRIVATE_/);
    assert.equal(details, 'About $65 per person (reference captured 2026-10-16; check current rate; may not apply to this group)');
  } finally { ctx.renderer.unmount(); }
});

test('disabled disables every control through the fieldset', async () => {
  const ctx = await setup(makeItem(), true);
  try {
    assert.equal(ctx.renderer.find(n => n.type === 'fieldset').props.disabled, true);
  } finally { ctx.renderer.unmount(); }
  const base = await compared(); base.renderer.unmount(); const withShortlist = base.decision;
  const disabled = await setup(makeItem(withShortlist), true);
  try {
    assert.equal(disabled.renderer.find(n => n.type === 'fieldset').props.disabled, true);
    assert.equal(disabled.renderer.findAll(n => n.type === 'fieldset').length, 1);
    assert.ok(disabled.renderer.findAll(n => n.type === 'button').length >= 3);
  } finally { disabled.renderer.unmount(); }
});

test('reported preferences display by exact label without choosing or computing a consensus', async () => {
  const base = await compared(); base.renderer.unmount();
  const ctx = await setup(makeItem(base.decision), false, { results: [{ id: base.decision!.shortlist![1].id, label: 'DaVero Farms & Winery', preferences: 2, names: ['Ana', 'Ben'] }, { label: 'Unknown', preferences: 9, names: [] }], respondents: 5, missing: 3 });
  try {
    const text = ctx.text();
    assert.match(text, /5 responded · 3 haven't responded/);
    assert.match(text, /Preferences only\. Not a decision, booking, or attendance\./);
    assert.match(text, /2 preferences: Ana, Ben/);
    assert.doesNotMatch(text, /9 preferences/);
    assert.equal(ctx.emitted.length, 0);
    assert.doesNotMatch(text, /Chosen/);
  } finally { ctx.renderer.unmount(); }
});
