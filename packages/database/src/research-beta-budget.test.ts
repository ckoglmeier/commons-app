import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDatabase } from "./client";
import { operatorAuditEvents,people } from "./schema";
import { researchBetaAccounting,reserveResearchBetaSpend,settleResearchBetaSpend,ResearchBetaLimitError,RESEARCH_BETA_BUDGET } from "./research-beta-budget";
const row=(action:string,id:string,n:number)=>({action,resourceId:id,reason:JSON.stringify({microUsd:n})});
test("beta ledger counts unknown holds and rejects malformed or repeated settlement history",()=>{
 assert.deepEqual(researchBetaAccounting([row("research_beta.reserved","a",10_000_000)]),{accountedMicroUsd:10_000_000,unresolvedReservations:1});
 assert.deepEqual(researchBetaAccounting([row("research_beta.reserved","a",10_000_000),row("research_beta.settled","a",60_000)]),{accountedMicroUsd:60_000,unresolvedReservations:0});
 for(const rows of [[row("research_beta.settled","a",0)],[row("research_beta.reserved","a",1),row("research_beta.reserved","a",1)],[row("research_beta.reserved","a",1),row("research_beta.settled","a",0),row("research_beta.settled","a",0)],[row("research_beta.reserved","a",-1)]]) assert.throws(()=>researchBetaAccounting(rows),ResearchBetaLimitError);
});
test("persistent beta allowance serializes clients, preserves unknown charges and never resets after re-instantiation",{skip:process.env.COMMONS_RUN_DATABASE_TESTS!=="1"},async()=>{
 const url=process.env.TEST_DATABASE_URL!;assert.ok(["127.0.0.1","localhost"].includes(new URL(url).hostname));
 const database=createDatabase(url);const [actor]=await database.db.insert(people).values({displayName:"Disposable beta budget tester",authUserId:randomUUID()}).returning();
 try {
  const attempts=await Promise.allSettled([reserveResearchBetaSpend(actor.id,850000,url),reserveResearchBetaSpend(actor.id,850000,url)]);
  assert.equal(attempts.filter(x=>x.status==="fulfilled").length,1);
  const id=(attempts.find(x=>x.status==="fulfilled") as PromiseFulfilledResult<string>).value;
  await assert.rejects(reserveResearchBetaSpend(actor.id,1,url),ResearchBetaLimitError);
  await settleResearchBetaSpend(id,actor.id,9000000,url);
  await assert.rejects(settleResearchBetaSpend(id,actor.id,0,url),ResearchBetaLimitError);
  const second=await reserveResearchBetaSpend(actor.id,850000,url);
  const rows=await database.db.select().from(operatorAuditEvents).where(eq(operatorAuditEvents.resourceType,RESEARCH_BETA_BUDGET));
  assert.equal(researchBetaAccounting(rows).accountedMicroUsd,10000000);
  assert.equal(rows.filter(x=>x.action==="research_beta.reserved").length,2);
  await settleResearchBetaSpend(second,actor.id,1000000,url);
  await assert.rejects(reserveResearchBetaSpend(actor.id,1,url),ResearchBetaLimitError);
  await assert.rejects(database.db.transaction(async tx=>{await tx.execute("SET LOCAL ROLE authenticated");await tx.select().from(operatorAuditEvents);}));
 } finally {await database.db.delete(operatorAuditEvents).where(eq(operatorAuditEvents.actorPersonId,actor.id));await database.db.delete(people).where(eq(people.id,actor.id));await database.close();}
});
