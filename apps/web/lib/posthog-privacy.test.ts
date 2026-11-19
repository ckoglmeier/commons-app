import assert from 'node:assert/strict';
import test from 'node:test';
import { analyticsRoute, replayAttribute, safeProductEvent } from './posthog-privacy';

test('PostHog routes omit trip identity, draft/thread queries, and invitation credentials', () => {
  assert.equal(analyticsRoute('/new?draft=SECRET#token'), '/new');
  assert.equal(analyticsRoute('/c/private-trip/plan/?thread=PRIVATE'), '/c/[trip]/plan');
  assert.equal(analyticsRoute('/poll/private-id?token=SECRET'), '/poll/[poll]');
  for (const path of ['/auth/callback', '/join/SECRET', '/invite/SECRET', '/sign-in', '/account/create', '/admin', '/prototype/coordinator', '/api/v1/private', '/unknown-sensitive']) assert.equal(analyticsRoute(path), null, path);
});

test('PostHog custom events retain only explicitly allowed metadata', () => {
  assert.deepEqual(safeProductEvent('poll_draft_started', { surface: 'setup', prompt: 'PRIVATE', email: 'private@example.com', commonsSlug: 'SECRET', hasDraft: false }), { name: 'poll_draft_started', properties: { hasDraft: false, surface: 'setup' } });
  assert.equal(safeProductEvent('unknown_private_event', { prompt: 'PRIVATE' }), null);
  assert.deepEqual(safeProductEvent('event_creation_committed', { participantCount: Infinity, surface: 'PRIVATE', hasDates: 'PRIVATE' })?.properties, {});
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
  assert.equal(replayAttribute('href', 'https://commons.invalid/_next/static/css/123.css'), 'https://commons.invalid/_next/static/css/123.css');
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
