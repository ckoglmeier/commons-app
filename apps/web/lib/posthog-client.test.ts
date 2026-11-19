import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

async function loadClient(define: Record<string, string>) {
  const bundle = await build({ stdin: { contents: `export * from './lib/posthog-client'; export { state } from 'posthog-js';`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'node', define, plugins: [{ name: 'fake-sdk', setup(b) {
    b.onResolve({ filter: /^posthog-js$/ }, () => ({ path: 'sdk', namespace: 'test' }));
    b.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: `export const state={events:[],recording:false,inits:0};let config;
      const client={init(k,c){config=c;state.inits++},capture(event,properties={}){const item=config.before_send({event,properties});if(item)state.events.push(item)},startSessionRecording(){state.recording=true},stopSessionRecording(){state.recording=false},reset(){}};export default client;` }));
  } }] });
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
}
const storage = () => { const values = new Map<string,string>(); return { getItem: (key:string) => values.get(key) ?? null, setItem: (key:string,value:string) => values.set(key,value), removeItem:(key:string) => values.delete(key) }; };
const environment = (hostname: string) => Object.assign(globalThis, { window: {}, location: { hostname, pathname: '/new' }, localStorage: storage(), sessionStorage: storage(), document: { querySelector: () => null, referrer: 'https://chatgpt.com/c/PRIVATE' } });

test('PostHog runs on any host when a key is set, records no replay by default, and keeps acquisition free of private referrer text', async () => {
  environment('trips.example.invalid');
  const client = await loadClient({ 'process.env.NEXT_PUBLIC_POSTHOG_KEY': JSON.stringify('phc_test') });
  assert.equal(client.posthogAllowed(), true);
  await client.updatePosthogRoute();
  assert.equal(client.state.recording, false, 'session replay needs NEXT_PUBLIC_POSTHOG_REPLAY=true');
  assert.ok(client.state.events.some((event: { event: string }) => event.event === '$pageview'));
  client.capturePosthogEvent('trip_created');
  await new Promise(resolve => setImmediate(resolve));
  const created = client.state.events.find((event: { event: string }) => event.event === 'trip_created');
  assert.ok(created);
  assert.equal(created.properties.first_acquisition_source, 'chatgpt');
  assert.ok(!JSON.stringify(client.state.events).includes('PRIVATE'));
  assert.ok(!JSON.stringify(client.state.events).includes('commons.travel'));
  // Rerenders on the same route do not duplicate views, and public routes are reported as shapes only.
  for (const pathname of ['/trip-templates/friends-trips/', '/destinations/savannah/', '/support/']) {
    Object.assign(location, { pathname });
    const before = client.state.events.filter((e: { event: string }) => e.event === '$pageview').length;
    await client.updatePosthogRoute(); await client.updatePosthogRoute();
    assert.equal(client.state.events.filter((e: { event: string }) => e.event === '$pageview').length, before + 1);
    assert.equal(client.state.events.at(-1).properties.$pathname, pathname.replace(/\/$/, ''));
  }
});

test('session replay starts only when NEXT_PUBLIC_POSTHOG_REPLAY is "true"', async () => {
  environment('trips.example.invalid');
  const client = await loadClient({ 'process.env.NEXT_PUBLIC_POSTHOG_KEY': JSON.stringify('phc_test'), 'process.env.NEXT_PUBLIC_POSTHOG_REPLAY': JSON.stringify('true') });
  await client.updatePosthogRoute();
  assert.equal(client.state.recording, true);
});

test('nothing starts without a key, and opt-out, Do Not Track and Global Privacy Control always win', async () => {
  environment('trips.example.invalid');
  const keyless = await loadClient({});
  await keyless.updatePosthogRoute();
  keyless.capturePosthogEvent('trip_created');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(keyless.state.inits, 0);
  assert.equal(keyless.state.events.length, 0);

  const client = await loadClient({ 'process.env.NEXT_PUBLIC_POSTHOG_KEY': JSON.stringify('phc_test') });
  localStorage.setItem('commons:analytics:opt-out', 'true');
  assert.equal(client.posthogAllowed(), false);
  localStorage.removeItem('commons:analytics:opt-out');
  const dnt = Object.getOwnPropertyDescriptor(navigator, 'doNotTrack');
  const gpc = Object.getOwnPropertyDescriptor(navigator, 'globalPrivacyControl');
  try {
    Object.defineProperty(navigator, 'doNotTrack', { configurable: true, value: '1' });
    assert.equal(client.posthogAllowed(), false);
    Object.defineProperty(navigator, 'doNotTrack', { configurable: true, value: '0' });
    Object.defineProperty(navigator, 'globalPrivacyControl', { configurable: true, value: true });
    assert.equal(client.posthogAllowed(), false);
  } finally {
    if (dnt) Object.defineProperty(navigator, 'doNotTrack', dnt); else Reflect.deleteProperty(navigator, 'doNotTrack');
    if (gpc) Object.defineProperty(navigator, 'globalPrivacyControl', gpc); else Reflect.deleteProperty(navigator, 'globalPrivacyControl');
  }
});
