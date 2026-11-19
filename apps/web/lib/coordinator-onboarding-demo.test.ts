import assert from 'node:assert/strict';
import test from 'node:test';
import { initialDemo, beginConversation, propose, approveTopics, createDemo, recordDecision, restoreDemo } from './coordinator-onboarding-demo';
test('help and recommendation stay inline; selection stages until creation', () => {
 const s=propose(beginConversation(initialDemo()),'dates');
 assert.equal(s.screen,'setup'); assert.equal(s.topics.length,0); assert.equal(s.proposed.length,1);
 const selected=approveTopics(s); assert.equal(selected.topics.length,0); assert.equal(selected.staged,true);
 const created=createDemo(selected); assert.equal(created.screen,'workspace'); assert.equal(created.topics.length,1);
 assert.equal(created.topics[0].approvedBy,'Alex'); assert.deepEqual(createDemo(created),created);
});
test('skip creates no topic; merely opening help does not count as engagement',()=>{
 const s=beginConversation(initialDemo()); assert.equal(s.engaged,false);
 assert.equal(createDemo(s).topics.length,0);
});
test('existing trip approval is idempotent and stale proposals cannot apply',()=>{
 const s=propose(initialDemo('skipped'),'stay'); const approved=approveTopics(s);
 assert.equal(approved.topics.length,1); assert.equal(approved.engaged,true);
 assert.equal(approveTopics({...approved,proposed:s.proposed}).topics.length,1);
 assert.equal(approveTopics({...s,revision:2}).topics.length,0);
 const pending=approveTopics(propose(initialDemo(),'dates'));
 assert.equal(createDemo({...pending,revision:2}).created,false);
});
test('traveler boundaries and decision approval remain explicit',()=>{
 const s=initialDemo('traveler'); assert.deepEqual(beginConversation(s),s); assert.deepEqual(approveTopics(s),s); assert.deepEqual(createDemo(s),s); assert.deepEqual(recordDecision(s,'Changed'),s);
 const poll=initialDemo('poll'); assert.equal(recordDecision({...poll,revision:2},'Dates').decision,'');
 assert.equal(recordDecision(poll,'October 16–19').topics[0].status,'Decided');
});
test('resume and style changes preserve history, draft text, engagement and dismissal',()=>{
 const s={...beginConversation(initialDemo('skipped')), input:'Keep me', personality:'joan' as const, engaged:true,dismissed:true};
 assert.deepEqual(beginConversation(s).messages,s.messages); assert.equal(beginConversation(s).input,'Keep me');
 assert.deepEqual(restoreDemo(JSON.stringify(s)),s);
 assert.deepEqual(restoreDemo(JSON.stringify({...s,version:1})),initialDemo());
});
