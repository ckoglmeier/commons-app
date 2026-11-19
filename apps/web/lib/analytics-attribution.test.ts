import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { acquisitionFromEntry, safeAcquisitionProperties, acquisitionFromCookie } from './analytics-attribution';

test('search and AI referrals classify without transmitting URLs or search terms', () => {
  for (const [host, source, channel] of [
    ['www.google.com', 'google', 'organic_search'], ['www.google.co.uk', 'google', 'organic_search'],
    ['bing.com', 'bing', 'organic_search'], ['duckduckgo.com', 'duckduckgo', 'organic_search'],
    ['chatgpt.com', 'chatgpt', 'ai'], ['chat.openai.com', 'chatgpt', 'ai'], ['claude.ai', 'claude', 'ai'],
    ['www.perplexity.ai', 'perplexity', 'ai'], ['gemini.google.com', 'gemini', 'ai'], ['copilot.microsoft.com', 'copilot', 'ai'],
  ]) {
    const result = acquisitionFromEntry('', `https://${host}/private?q=SECRET`, '/');
    assert.equal(result.acquisition_source, source);
    assert.equal(result.acquisition_channel, channel);
    assert.equal(result.referring_domain, host);
    assert.ok(!JSON.stringify(result).includes('SECRET'));
  }
  assert.equal(acquisitionFromEntry('', 'https://google.com.evil.example/', '/').acquisition_channel, 'referral');
  Object.assign(globalThis, { location: { hostname: 'trips.example.test' } });
  try {
    for (const ref of ['', 'invalid', 'https://trips.example.test/sign-in/?token=SECRET', 'https://accounts.google.com/']) {
      assert.equal(acquisitionFromEntry('', ref, '/').acquisition_channel, 'direct');
    }
  } finally { delete (globalThis as { location?: unknown }).location; }
});

test('explicit campaigns override referrals, hidden AI referrals can be tagged, and private metadata is rejected', () => {
  const tagged = acquisitionFromEntry('?utm_source=chatgpt&utm_campaign=fall&email=SECRET', 'https://www.google.com/', '/support');
  assert.equal(tagged.acquisition_source, 'chatgpt');
  assert.equal(tagged.acquisition_channel, 'ai');
  assert.equal(acquisitionFromEntry('?utm_source=google&utm_medium=cpc', '', '/').acquisition_channel, 'paid_search');
  assert.equal(acquisitionFromEntry('?utm_source=newsletter&utm_medium=email', '', '/').acquisition_channel, 'campaign');
  assert.deepEqual(safeAcquisitionProperties({first_acquisition_source:'chatgpt', latest_acquisition_channel:'ai', first_landing_page:'/c/PRIVATE', landing_page:'/support?SECRET', referring_domain:'https://SECRET', prompt:'SECRET'}), { first_acquisition_source:'chatgpt', latest_acquisition_channel:'ai' });
});

test('first touch and latest non-direct survive internal navigation, direct return and authentication; opt-out suppresses', async () => {
  const bundle = await build({stdin:{contents:"export {attributionProperties} from './lib/analytics-attribution';",resolveDir:process.cwd()}, bundle:true,write:false,format:'esm',platform:'node'});
  let serial = 0;
  const load = () => import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text+`\n// instance ${serial++}`).toString('base64')}`);
  const store = () => { const map=new Map<string,string>(); return { getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>map.set(k,v),removeItem:(k:string)=>map.delete(k) }; };
  Object.assign(globalThis,{window:{},location:{pathname:'/support/',search:''},document:{referrer:'https://www.google.com/search?q=SECRET'},localStorage:store(),sessionStorage:store()});
  let client = await load();
  let props=client.attributionProperties();
  assert.equal(props.first_acquisition_source,'google');
  assert.equal(props.first_landing_page,'/support');
  Object.assign(location,{pathname:'/new',search:''});
  props=client.attributionProperties();
  assert.equal(props.landing_page,'/support');
  assert.equal(props.latest_acquisition_source,'google');
  Object.assign(location,{search:'?utm_source=chatgpt'});
  props=client.attributionProperties();
  assert.equal(props.first_acquisition_source,'google');
  assert.equal(props.latest_acquisition_source,'chatgpt');
  Object.assign(location,{search:''});
  props=client.attributionProperties();
  assert.equal(props.latest_acquisition_source,'chatgpt', 'fixed document.referrer must not replace the explicit campaign');
  Object.assign(globalThis,{sessionStorage:store()});
  Object.assign(document,{referrer:''});
  client=await load(); props=client.attributionProperties();
  assert.equal(props.acquisition_source,'direct');
  assert.equal(props.first_acquisition_source,'google');
  assert.equal(props.latest_acquisition_source,'chatgpt');
  localStorage.setItem('commons:analytics:opt-out','true');
  assert.deepEqual(client.attributionProperties(),{});
});


test('server acquisition cookie rejects invalid metadata and honors opt-out', () => {
  const cookie = `commons_acquisition_v1=${encodeURIComponent(JSON.stringify({first_acquisition_source:'google', first_acquisition_channel:'organic_search', first_landing_page:'/support', prompt:'PRIVATE', referring_domain:'https://PRIVATE'}))}`;
  assert.deepEqual(acquisitionFromCookie(cookie), {first_acquisition_source:'google', first_acquisition_channel:'organic_search', first_landing_page:'/support'});
  assert.deepEqual(acquisitionFromCookie(cookie+'; commons_analytics_opt_out=1'), {});
  for (const value of ['commons_acquisition_v1=%ZZ', 'commons_acquisition_v1=null', 'commons_acquisition_v1='+ 'x'.repeat(6100)]) assert.deepEqual(acquisitionFromCookie(value), {});
});
