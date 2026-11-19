import test from 'node:test';
import assert from 'node:assert/strict';
import { tripTypes } from './templates';
import { templateGuidance } from './template-guidance';
import { templateArtwork, resolveLocalArt } from './artwork';
test('every template has its own complete answer, example and follow-up',()=>{
 assert.deepEqual(Object.keys(templateGuidance).sort(),tripTypes.map(t=>t.slug).sort());
 for(const key of ['title','question','answer','scenario','cost','followup','response'] as const)assert.equal(new Set(tripTypes.map(t=>templateGuidance[t.slug][key])).size,18,key);
 for(const t of tripTypes){const g=templateGuidance[t.slug];assert.equal(g.decisions.length,3);assert.ok(!g.title.includes('trips trip'));assert.ok(g.cost.includes('$'));}
});
test('legacy cover keys remain resolvable alongside new defaults',()=>{
 const keys=new Set(Object.values(templateArtwork).map(a=>a.key));
 for(const key of ['template:gathering:v1','template:shared-shore:v1','template:friends-courtyard:v1','template:celebration-table:v1'])assert.ok(keys.has(key),key);
 assert.equal(resolveLocalArt('lisbon','friends-trips')?.key,'destination:lisbon:v1');
});
