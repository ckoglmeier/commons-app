import assert from 'node:assert/strict';
import test from 'node:test';
import { posthogConfig } from './posthog-config';

test('SDK payload filter strips implicit identity, referrer, URL queries, and unapproved properties', () => {
  const config = posthogConfig('https://us.i.posthog.com', () => true, () => '/new?draft=PRIVATE');
  const filter = config.before_send;
  assert.equal(typeof filter, 'function');
  if (typeof filter !== 'function') throw new Error('Missing filter');
  const result = filter({ uuid: 'event-id', event: 'coordinator_selected', $set: { email: 'PRIVATE' }, properties: { token: 'phc_public_project', distinct_id: 'anonymous', personality: 'joan', $current_url: 'PRIVATE', $referrer: 'PRIVATE', email: 'PRIVATE', prompt: 'PRIVATE' } });
  assert.ok(result);
  assert.equal(result.properties.personality, 'joan');
  assert.equal(result.properties.token, 'phc_public_project');
  assert.equal(result.properties.$current_url, 'https://commons.invalid/new');
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  const pageview = filter({ uuid: 'pageview-id', event: '$pageview', properties: { token: 'phc_public_project', distinct_id: 'anonymous', $current_url: 'PRIVATE' } });
  assert.equal(pageview?.event, '$pageview');
  assert.equal(pageview?.properties.$current_url, 'https://commons.invalid/new');
  assert.equal(filter({ uuid: 'id', event: '$autocapture', properties: {} }), null);
});

test('excluded routes and opt-outs discard even replay payloads', () => {
  const filter = posthogConfig('https://us.i.posthog.com', () => false, () => '/auth/callback').before_send;
  if (typeof filter !== 'function') throw new Error('Missing filter');
  assert.equal(filter({ uuid: 'id', event: '$snapshot', properties: { $snapshot_data: ['PRIVATE'] } }), null);
});

test('network capture removes requests and normalizes replay navigation', () => {
  const config = posthogConfig('https://us.i.posthog.com', () => true, () => '/c/PRIVATE/coordinator/?thread=PRIVATE');
  const mask = config.session_recording?.maskCapturedNetworkRequestFn;
  assert.ok(mask);
  assert.equal(mask({ name: 'https://private.example', method: 'POST', duration: 0, entryType: 'resource', startTime: 0 }), null);
  assert.equal(mask({ name: 'https://commons.invalid/c/PRIVATE', isInitial: true, duration: 0, entryType: 'navigation', startTime: 0 })?.name, 'https://commons.invalid/c/[trip]/coordinator');
  assert.equal(config.enable_recording_console_log, false);
  assert.equal(config.disable_session_recording, true);
  assert.equal(config.session_recording?.inlineStylesheet, false);
  assert.equal(config.session_recording?.maskAllInputs, true);
  assert.equal(config.session_recording?.maskTextSelector, '.ph-mask, [data-replay-mask]');
});

test('identified testers have only explicitly authorized name and email person properties', () => {
  const config = posthogConfig('https://us.i.posthog.com', () => true, () => '/new');
  assert.equal(config.person_profiles, 'identified_only');
  const filter = config.before_send;
  if (typeof filter !== 'function') throw new Error('Missing filter');
  const result = filter({ uuid: 'id', event: '$identify', $set: { name: 'Synthetic Tester', email: 'tester@example.invalid', phone: 'PRIVATE', prompt: 'PRIVATE' }, $set_once: { initial_url: 'PRIVATE' }, properties: { token: 'phc_public', distinct_id: 'auth-user-id', $anon_distinct_id: 'previous-anonymous-id' } });
  assert.deepEqual(result?.$set, { name: 'Synthetic Tester', email: 'tester@example.invalid' });
  assert.equal(result?.properties.$anon_distinct_id, 'previous-anonymous-id');
  assert.equal(result?.properties.$process_person_profile, true);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});

test('marketing pageviews retain only the canonical route and approved metadata', () => {
  const filter = posthogConfig('https://us.i.posthog.com', () => true, () => '/destinations/savannah/?email=PRIVATE#PRIVATE').before_send;
  if (typeof filter !== 'function') throw new Error('Missing filter');
  const result = filter({uuid:'test', event:'$pageview', properties: { $referrer:'PRIVATE', inputs:'PRIVATE', lodgingPerNight:123, $current_url:'PRIVATE', deviceClass:'mobile' }});
  assert.equal(result?.properties.$pathname, '/destinations/savannah');
  assert.equal(result?.properties.$current_url, 'https://commons.invalid/destinations/savannah');
  assert.equal(result?.properties.deviceClass, 'mobile');
  assert.equal(result?.properties.lodgingPerNight, undefined);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  const excluded = posthogConfig('https://us.i.posthog.com', () => true, () => '/destinations/PRIVATE').before_send;
  if (typeof excluded !== 'function') throw new Error('Missing filter');
  assert.equal(excluded({uuid:'test',event:'$pageview',properties:{}}), null);
});
