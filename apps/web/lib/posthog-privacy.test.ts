import assert from 'node:assert/strict';
import test from 'node:test';
import { analyticsRoute, replayAttribute, safeProductEvent } from './posthog-privacy';

test('PostHog routes omit trip identity, draft/thread queries, and invitation credentials', () => {
  assert.equal(analyticsRoute('/new?draft=SECRET#token'), '/new');
  assert.equal(analyticsRoute('/c/private-trip/coordinator/?thread=PRIVATE'), '/c/[trip]/coordinator');
  assert.equal(analyticsRoute('/poll/private-id?token=SECRET'), '/poll/[poll]');
  for (const path of ['/auth/callback', '/join/SECRET', '/invite/SECRET', '/sign-in', '/account/create', '/admin', '/prototype/coordinator', '/api/v1/private', '/unknown-sensitive']) assert.equal(analyticsRoute(path), null, path);
});

test('PostHog custom events retain only explicitly allowed metadata', () => {
  assert.deepEqual(safeProductEvent('coordinator_reply_received', { surface: 'setup', personality: 'joan', prompt: 'PRIVATE', email: 'private@example.com', commonsSlug: 'SECRET', hasDraft: false }), { name: 'coordinator_reply_received', properties: { hasDraft: false, personality: 'joan', surface: 'setup' } });
  assert.equal(safeProductEvent('unknown_private_event', { prompt: 'PRIVATE' }), null);
  assert.deepEqual(safeProductEvent('event_creation_committed', { participantCount: Infinity, surface: 'PRIVATE', personality: 'PRIVATE', hasDates: 'PRIVATE' })?.properties, {});
});

test('PostHog coordinator and voice events keep closed vocabularies and numbers, and never ids, text or free-form codes', () => {
  const event = safeProductEvent('coordinator_voice_delegated', { inputMode: 'voice', capability: 'research', errorCode: 'auth_expired', outcome: 'completed', delegationLatencyMs: 1234.6, latencyMs: 80, queued: false,
    sessionId: 'live_SECRET', delegationId: 'item_SECRET', commandId: 'SECRET', threadId: 'SECRET', turnId: 'SECRET', transcript: 'PRIVATE words', errorMessage: 'PRIVATE' });
  assert.deepEqual(event?.properties, { inputMode: 'voice', capability: 'research', errorCode: 'auth_expired', outcome: 'completed', delegationLatencyMs: 1235, latencyMs: 80, queued: false });
  assert.deepEqual(safeProductEvent('coordinator_voice_failed', { errorCode: 'microphone_denied' })?.properties, { errorCode: 'microphone_denied' });
  assert.deepEqual(safeProductEvent('coordinator_reply_failed', { inputMode: 'PRIVATE', capability: 'PRIVATE', errorCode: 'PRIVATE', outcome: 'PRIVATE', latencyMs: -1, delegationLatencyMs: Infinity, queued: 'PRIVATE' })?.properties, {});
});

test('Replay retains readable labels and CSS but strips credentials and form values', () => {
  for (const name of ['href', 'value', 'id', 'data-private', 'style', 'srcset']) assert.equal(replayAttribute(name, 'PRIVATE'), '', name);
  assert.equal(replayAttribute('href', '/_next/static/css/123.css'), '/_next/static/css/123.css');
  assert.equal(replayAttribute('href', '/_next/static/css/123.css?token=PRIVATE'), '');
  assert.equal(replayAttribute('rel', 'stylesheet'), 'stylesheet');
  assert.equal(replayAttribute('aria-label', 'Add expense'), 'Add expense');
  assert.equal(replayAttribute('src', '/covers/savannah.webp'), '/covers/savannah.webp');
  assert.equal(replayAttribute('src', 'https://example.com/photo?token=SECRET'), '');
  assert.equal(replayAttribute('src', 'data:text/html,SECRET'), '');
  assert.equal(replayAttribute('href', 'https://www.commons.travel/_next/static/css/123.css'), 'https://www.commons.travel/_next/static/css/123.css');
  assert.equal(replayAttribute('class', 'cm-action'), 'cm-action');
  assert.equal(replayAttribute('aria-expanded', 'true'), 'true');
});

test('every marketing publication candidate has an explicit, query-free analytics route', async () => {
  const { publicPageCandidates } = await import('./marketing/pages/metadata-map');
  const { default: routes } = await import('./marketing/analytics-routes.json');
  const candidates = publicPageCandidates().map(page => page.path.replace(/\/$/, ''));
  assert.deepEqual([...routes].sort(), candidates.sort(), 'Update the lightweight route manifest when adding pages');
  for (const path of [...candidates, '/support', '/legal/terms', '/legal/privacy']) {
    assert.equal(analyticsRoute(`${path}/?email=PRIVATE#PRIVATE`), path);
    assert.equal(analyticsRoute(path), path);
  }
  for (const path of ['/destinations/PRIVATE', '/trip-templates/PRIVATE', '/guides/PRIVATE', '/assistants/PRIVATE', '/legal/PRIVATE', '/profile', '/group-join/PRIVATE']) assert.equal(analyticsRoute(path), null);
});
