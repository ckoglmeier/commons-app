import test from 'node:test';
import assert from 'node:assert/strict';
import {withCoordinatorScenario,databaseTestsEnabled} from './coordinator-route-harness';
test('candidate real route delivers a grounded absence report unchanged and without mutation', {skip:!databaseTestsEnabled},()=>withCoordinatorScenario(async s=>{
 const reply='No dinner plan or decision is saved for the Feb 12–15 Breckenridge trip, so dinner details remain unresolved in this conversation.';
 s.next.reply=reply;
 const result=await s.post(s.command({text:'What still needs a decision about dinner?'}));
 assert.equal(result.body.status,'completed');assert.equal(result.body.durableAnswer,reply);
 assert.deepEqual(result.body.artifacts,[]);assert.equal(result.body.reviewRequired,false);
 const call=s.network.providerCalls.find(row=>row.body.model==='gpt-6-luna');assert.ok(call);
 assert.equal((call.body as Record<string,unknown>).reasoning_effort,'none');
}, {environment:{COMMONS_COORDINATOR_INFERENCE_POLICY:'openai-luna-none'}}));
