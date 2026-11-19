import { z } from 'zod';
import { CoordinatorPersonalityIdSchema } from '@commons/contracts';

export const DEMO_KEY = 'commons-coordinator-onboarding-v2';
export const sampleDescription = 'Six friends, a long weekend in October. Somewhere in the mountains, with time to cook together. Dates and a place to stay are still open.';
const Topic = z.object({ id: z.string(), title: z.string(), status: z.enum(['Exploring', 'Draft', 'Waiting for responses', 'Decided']), selected: z.boolean(), approvedBy: z.string().optional() });
export const DemoSchema = z.object({
  version: z.literal(2), scenario: z.enum(['new', 'skipped', 'returning', 'poll', 'traveler']),
  screen: z.enum(['describe', 'setup', 'workspace']),
  helpOpen: z.boolean(), engaged: z.boolean(), staged: z.boolean(), created: z.boolean(), dismissed: z.boolean(), personality: CoordinatorPersonalityIdSchema,
  description: z.string(), facts: z.string(), input: z.string(),
  messages: z.array(z.object({ author: z.string(), text: z.string() })),
  proposed: z.array(Topic), topics: z.array(Topic), active: z.string(),
  revision: z.number(), baseRevision: z.number(), decision: z.string(), draft: z.string(),
  notice: z.string(),
});
export type DemoState = z.infer<typeof DemoSchema>;
export type Scenario = DemoState['scenario'];
export const scenarios: { id: Scenario; label: string }[] = [
  { id: 'new', label: 'New trip' }, { id: 'skipped', label: 'Skipped onboarding' },
  { id: 'returning', label: 'Returning organizer' }, { id: 'poll', label: 'Poll ready to review' }, { id: 'traveler', label: 'Traveler view' },
];
export function initialDemo(scenario: Scenario = 'new'): DemoState {
  const returning = scenario === 'returning' || scenario === 'traveler';
  const topics: DemoState['topics'] = returning ? [
    { id: 'dates', title: 'Find dates', status: 'Decided', selected: true, approvedBy: 'Alex' },
    { id: 'stay', title: 'Choose where to stay', status: 'Exploring', selected: true, approvedBy: 'Alex' },
  ] : scenario === 'poll' ? [{ id: 'dates', title: 'Find dates', status: 'Waiting for responses', selected: true, approvedBy: 'Alex' }] : [];
  return { version: 2, scenario, screen: scenario === 'new' ? 'describe' : 'workspace', helpOpen: false, engaged: false, staged: false, created: scenario !== 'new', dismissed: false,
    personality: 'commons', description: sampleDescription,
    facts: returning ? 'Six friends · October 16–19, 2026 · Mountains; destination undecided' : 'Six friends · October · Mountains; exact dates and destination undecided',
    input: '', messages: [], proposed: [], topics, active: returning ? 'stay' : topics[0]?.id ?? '', revision: 1, baseRevision: 1,
    decision: returning ? 'October 16–19, 2026 — approved by Alex from the date poll.' : '', draft: '', notice: '' };
}
export function restoreDemo(raw: string | null): DemoState {
  try { return DemoSchema.parse(JSON.parse(raw ?? 'null')); } catch { return initialDemo(); }
}
const names = { commons: 'Commons', joan: 'Joan', becky: 'Becky', miles: 'Miles' };
export function opening(state: DemoState): string {
  if (state.decision) return `The recorded decision is ${state.decision} Would you like to work on the next open question?`;
  if (state.scenario === 'poll') return 'October 16–19 leads with 3 votes; October 23–26 has 1. Two people have not replied. Would you like to review a proposed decision or keep waiting?';
  if (state.description !== sampleDescription || (state.facts !== sampleDescription && state.facts !== initialDemo().facts)) return 'I’ve kept your description as written. This authored demo cannot interpret new details. Choose one open question below, or continue with your trip.';
  const voices = {
    commons: 'I’d start with the next unresolved decision. For the sample October brief, dates narrow the stay search. You can change that starting point below.',
    joan: 'We can leave the open details open for now. Which would make this easier: settling dates, finding a place to stay, or working out a comfortable cost?',
    becky: 'Cooking together gives the weekend a shared anchor. Shall we start with dates everyone can weigh in on, a place to stay, or a comfortable cost?',
    miles: 'I’d settle the dates first so the stay search has a useful constraint. Would you start there, with the stay, or with cost?',
  };
  return voices[state.personality];
}
export function beginConversation(state: DemoState): DemoState {
  if (state.scenario === 'traveler') return state;
  return { ...state, screen: state.created ? 'workspace' : 'setup', helpOpen: true, messages: state.messages.length ? state.messages : [
    { author: 'Alex · organizer', text: state.facts }, { author: `${names[state.personality]} · Commons AI`, text: opening(state) },
  ], notice: '' };
}
export function propose(state: DemoState, focus: 'dates' | 'stay' | 'budget' | 'unknown'): DemoState {
  const titles = { dates: 'Find dates', stay: 'Choose where to stay', budget: 'Agree on a budget', unknown: 'Work out what comes first' };
  return { ...state, screen: state.created ? 'workspace' : 'setup', helpOpen: true, staged: false,
    baseRevision: state.revision, proposed: [{ id: focus, title: titles[focus], selected: true, status: 'Exploring' }] };
}
export function approveTopics(state: DemoState): DemoState {
  if (state.scenario === 'traveler') return state;
  if (state.baseRevision !== state.revision) return { ...state, notice: 'Another organizer changed the trip. Review the latest version before applying.' };
  const next = state.proposed[0];
  if (!next?.title.trim()) return { ...state, notice: 'Give this starting point a title first.' };
  if (!state.created) return { ...state, staged: true, engaged: true, helpOpen: false, notice: 'Starting point selected. It will be added only when you create the trip.' };
  return { ...state, engaged: true, proposed: [], topics: state.topics.some(t => t.id === next.id) ? state.topics : [...state.topics, { ...next, approvedBy: 'Alex' }], active: next.id,
    screen: 'workspace', notice: 'Starting topic approved by Alex. Only trip organizers can see it.' };
}
export function createDemo(state: DemoState): DemoState {
  if (state.scenario === 'traveler' || state.created || state.baseRevision !== state.revision) return state;
  const topic = state.staged ? state.proposed[0] : null;
  if (topic && !topic.title.trim()) return { ...state, notice: 'Give the selected starting point a title or remove it.' };
  return { ...state, created: true, screen: 'workspace', helpOpen: false, proposed: [], staged: false,
    topics: topic ? [{ ...topic, approvedBy: 'Alex' }] : [], active: topic?.id ?? '',
    notice: topic ? 'Sample trip and selected organizer topic created. No invitations sent.' : 'Sample trip created. No invitations sent.' };
}

export function recordDecision(state: DemoState, text: string): DemoState {
  if (state.scenario === 'traveler' || !text.trim() || state.baseRevision !== state.revision) return state;
  return { ...state, decision: text.trim(), topics: state.topics.map(t => t.id === 'dates' ? { ...t, status: 'Decided', approvedBy: 'Alex' } : t), notice: 'Decision recorded by Alex for the group. No itinerary item was added; no message was sent.' };
}
