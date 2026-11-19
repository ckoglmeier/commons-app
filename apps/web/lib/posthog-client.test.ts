import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

test('excluded and unresolved identities never capture; real testers recover after account changes', async () => {
  const bundle = await build({ stdin: { contents: `export * from './lib/posthog-client'; export { state } from 'posthog-js';`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'node', define: { 'process.env.NEXT_PUBLIC_POSTHOG_KEY': JSON.stringify('phc_test') }, plugins: [{ name: 'fake-sdk', setup(b) {
    b.onResolve({ filter: /^posthog-js$/ }, () => ({ path: 'sdk', namespace: 'test' }));
    b.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: `export const state={events:[],recording:false,resets:0};let config;
      const client={init(k,c){config=c},capture(event,properties={}){const item=config.before_send({event,properties});if(item)state.events.push(item)},identify(id,props){client.capture('$identify',{distinct_id:id,$set:props})},startSessionRecording(){state.recording=true},stopSessionRecording(){state.recording=false},reset(){state.resets++}};export default client;` }));
  } }] });
  const storage = () => { const values = new Map<string,string>(); return { getItem: (key:string) => values.get(key) ?? null, setItem: (key:string,value:string) => values.set(key,value), removeItem:(key:string) => values.delete(key) }; };
  Object.assign(globalThis, { window: {}, location: { hostname: 'www.commons.travel', pathname: '/new' }, localStorage: storage(), sessionStorage: storage(), document: { querySelector: () => null, referrer: 'https://chatgpt.com/c/PRIVATE' } });
  let response = { excluded: true, identity: null as null | { id: string; email: string } };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json(response);
  try {
    const client = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
    await client.updatePosthogRoute();
    client.capturePosthogEvent('workspace_opened');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(client.state.events.length, 0);
    assert.equal(client.state.recording, false);
    response = { excluded: false, identity: { id: 'real-tester', email: 'tester@example.invalid' } };
    await client.refreshPosthogIdentity(); await client.updatePosthogRoute();
    assert.equal(client.state.recording, true);
    assert.ok(client.state.events.some((event: {event:string}) => event.event === '$identify'));
    assert.ok(client.state.events.some((event: {event:string}) => event.event === '$pageview'));
    for (const event of ['event_creation_access_requested', 'event_creation_committed', 'trip_created']) client.capturePosthogEvent(event);
    await new Promise(resolve => setImmediate(resolve));
    for (const name of ['account_identified', 'event_creation_access_requested', 'event_creation_committed', 'trip_created']) {
      const event = client.state.events.find((event: {event:string}) => event.event === name);
      assert.ok(event, name);
      assert.equal(event.properties.first_acquisition_source, 'chatgpt', name);
      assert.equal(event.properties.latest_acquisition_channel, 'ai', name);
      assert.ok(!JSON.stringify(event).includes('PRIVATE'));
    }
    const profile = client.state.events.find((event: {event:string}) => event.event === '$identify');
    assert.equal(profile.$set.first_acquisition_source, 'chatgpt');
    // Anonymous visitors traverse the new public routes; rerenders do not duplicate views.
    response = { excluded: false, identity: null };
    await client.refreshPosthogIdentity();
    for (const pathname of ['/trip-templates/friends-trips/', '/destinations/savannah/', '/group-organizers/', '/assistants/chatgpt/', '/support/']) {
      Object.assign(location, {pathname});
      const before = client.state.events.filter((e: {event:string}) => e.event === '$pageview').length;
      await client.updatePosthogRoute(); await client.updatePosthogRoute();
      assert.equal(client.state.events.filter((e: {event:string}) => e.event === '$pageview').length, before + 1);
      assert.equal(client.state.events.at(-1).properties.$pathname, pathname.replace(/\/$/, ''));
    }
    for (const hostname of ['localhost', '127.0.0.1', 'commons-travel-review.casey-rivera.chatgpt.site']) {
      Object.assign(location, {hostname});
      assert.equal(client.posthogAllowed(), false);
    }
    Object.assign(location, {hostname:'www.commons.travel'});
    localStorage.setItem('commons:analytics:opt-out', 'true');
    assert.equal(client.posthogAllowed(), false);
    localStorage.removeItem('commons:analytics:opt-out');
    const dnt = Object.getOwnPropertyDescriptor(navigator, 'doNotTrack');
    const gpc = Object.getOwnPropertyDescriptor(navigator, 'globalPrivacyControl');
    try {
      Object.defineProperty(navigator, 'doNotTrack', { configurable:true, value:'1' });
      assert.equal(client.posthogAllowed(), false);
      Object.defineProperty(navigator, 'doNotTrack', { configurable:true, value:'0' });
      Object.defineProperty(navigator, 'globalPrivacyControl', { configurable:true, value:true });
      assert.equal(client.posthogAllowed(), false);
    } finally {
      if (dnt) Object.defineProperty(navigator, 'doNotTrack', dnt); else Reflect.deleteProperty(navigator, 'doNotTrack');
      if (gpc) Object.defineProperty(navigator, 'globalPrivacyControl', gpc); else Reflect.deleteProperty(navigator, 'globalPrivacyControl');
    }
    const count = client.state.events.length;
    response = { excluded: true, identity: null };
    await client.refreshPosthogIdentity(); await client.updatePosthogRoute();
    client.capturePosthogEvent('workspace_opened');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(client.state.events.length, count);
    assert.equal(client.state.recording, false);
    globalThis.fetch = async () => new Response(null, { status: 503 });
    await client.refreshPosthogIdentity(); await client.updatePosthogRoute();
    assert.equal(client.state.events.length, count);
  } finally { globalThis.fetch = originalFetch; }
});
