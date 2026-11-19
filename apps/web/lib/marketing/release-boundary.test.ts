import test from 'node:test';
import assert from 'node:assert/strict';
import { marketingRoutesEnabled, marketingIndexingEnabled } from './route-mode';
import { publicPageCandidates } from './pages/metadata-map';
import { starterHref, startTripHref } from './pages/routes';
import sitemap from '../../app/sitemap';
import robots from '../../app/robots';
import nextConfig from '../../next.config';
test('public routes and indexing require separate explicit switches',()=>{
 const previous={...process.env};
 try {
  delete process.env.COMMONS_MARKETING_ROUTES_ENABLED;
  process.env.COMMONS_MARKETING_INDEXING_ENABLED='true';
  assert.equal(marketingRoutesEnabled(),false);
  assert.equal(marketingIndexingEnabled(),false);
  assert.deepEqual(sitemap(),[]);
  process.env.COMMONS_MARKETING_ROUTES_ENABLED='true';
  process.env.COMMONS_MARKETING_INDEXING_ENABLED='false';
  assert.equal(marketingRoutesEnabled(),true);
  assert.equal(marketingIndexingEnabled(),false);
  assert.equal(robots().sitemap,undefined);
  process.env.COMMONS_MARKETING_INDEXING_ENABLED='true';
  process.env.NEXT_PUBLIC_SITE_URL='https://www.commons.travel';
  const urls=sitemap().map(p=>p.url);
  assert.equal(urls.length,87);
  assert.equal(new Set(urls).size,87);
  assert.ok(urls.every(u=>!/(prototype|checkout|\/new\/|\/c\/)/.test(u)));
  assert.equal(robots().sitemap,'https://www.commons.travel/sitemap.xml');
 } finally { process.env=previous; }
});
test('search crawlers can revisit only retired samples and the noindex creation entry', async()=>{
 const rules=robots().rules;
 assert.ok(!Array.isArray(rules));
 const allow=Array.isArray(rules.allow)?rules.allow:[rules.allow!];
 const disallow=Array.isArray(rules.disallow)?rules.disallow:[rules.disallow!];
 const matches=(pattern:string,path:string)=>{
  const end=pattern.endsWith('$');
  const prefix=end?pattern.slice(0,-1):pattern;
  return end?path===prefix:path.startsWith(prefix);
 };
 const permitted=(path:string)=>{
  const matchedAllow=allow.filter(p=>matches(p,path)).map(p=>p.replace(/\$$/,'').length);
  const matchedDisallow=disallow.filter(p=>matches(p,path)).map(p=>p.replace(/\$$/,'').length);
  return Math.max(0,...matchedAllow)>=Math.max(0,...matchedDisallow);
 };
 for(const path of ['/new/','/c/10000000-0000-4000-8000-000000000001/','/c/10000000-0000-4000-8000-000000000001/?arrival=0&view=plan']) assert.equal(permitted(path),true,path);
 for(const path of ['/new/draft/','/c/private-trip/','/c/10000000-0000-4000-8000-000000000001-other/','/account/','/sign-in/']) assert.equal(permitted(path),false,path);
 const headers=await nextConfig.headers!();
 const entry=headers.find(rule=>rule.source==='/new');
 assert.ok(entry?.headers.some(header=>header.key==='X-Robots-Tag'&&header.value.includes('noindex')));
});
test('all 83 published pages have unique paths and product entry starts a trip',()=>{
 const pages=publicPageCandidates();
 assert.equal(pages.length,83);
 assert.equal(new Set(pages.map(p=>p.path)).size,83);
 assert.equal(starterHref('friends-trips','lisbon','test'),startTripHref);
 assert.ok(startTripHref.includes('intent=create'));
});
