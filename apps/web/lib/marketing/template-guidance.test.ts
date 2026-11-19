import test from 'node:test';
import assert from 'node:assert/strict';
import { tripTypes } from './templates';
import { templateGuidance } from './template-guidance';
import { templateArtwork, getRouteArtwork, resolveLocalArt } from './artwork';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
test('every template has its own complete answer, example and follow-up',()=>{
 assert.deepEqual(Object.keys(templateGuidance).sort(),tripTypes.map(t=>t.slug).sort());
 for(const key of ['title','question','answer','scenario','cost','followup','response'] as const)assert.equal(new Set(tripTypes.map(t=>templateGuidance[t.slug][key])).size,18,key);
 for(const t of tripTypes){const g=templateGuidance[t.slug];assert.equal(g.decisions.length,3);assert.ok(!g.title.includes('trips trip'));assert.ok(g.cost.includes('$'));}
});
test('all templates and main pages have distinct existing artwork',()=>{
 const core=['trip-templates','group-trip-planner','group-organizers','pricing','destinations','partners/destinations','assistants','assistants/chatgpt','assistants/claude','assistants/gemini','docs/assistant-handoff','partners/travel-assistants'];
 const art=[...tripTypes.map(t=>templateArtwork[t.slug]),...core.map(getRouteArtwork)];
 assert.equal(new Set(art.map(a=>a?.src)).size,30);
 for(const item of art){assert.ok(item);assert.ok(existsSync(join(process.cwd(),'public',item.src)),item.src);}
});
test('legacy cover keys remain resolvable alongside new defaults',()=>{
 const keys=new Set(Object.values(templateArtwork).map(a=>a.key));
 for(const key of ['template:gathering:v1','template:shared-shore:v1','template:friends-courtyard:v1','template:celebration-table:v1'])assert.ok(keys.has(key),key);
 assert.equal(resolveLocalArt('lisbon','friends-trips')?.key,'destination:lisbon:v1');
});
