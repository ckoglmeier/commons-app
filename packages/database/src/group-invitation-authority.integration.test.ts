import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and,eq,inArray } from "drizzle-orm";
import { createDatabase } from "./client";
import { commons,memberships,people } from "./schema";
import { getGroupInvitation,getGroupInvitationPreview,joinGroupInvitation,manageGroupInvitation } from "./group-invitation-repository";
const skip=process.env.COMMONS_RUN_DATABASE_TESTS!=="1";

test("a creator's lost organizer or pilot authority invalidates old links without removing joined travelers",{skip},async()=>{
  const url=process.env.TEST_DATABASE_URL!;assert.equal(new URL(url).hostname,"127.0.0.1");assert.ok(new URL(url).pathname.endsWith("_test"));
  const db=createDatabase(url),trip=randomUUID(),ids=[randomUUID(),randomUUID(),randomUUID()],[org,coOrg,traveler]=ids;
  let creatorEligible=true;
  const creatorCheck=async(authId:string)=>authId===coOrg||authId===org&&creatorEligible;
  const options={databaseUrl:url,actorPersonId:org,creatorCheck};
  await db.db.insert(people).values(ids.map(id=>({id,authUserId:id,displayName:id===org?"Original organizer":id===coOrg?"Current organizer":"Traveler"})));
  await db.db.insert(commons).values({id:trip,slug:trip,name:"Creator authority synthetic",createdByPersonId:org,timezone:"America/Denver"});
  await db.db.insert(memberships).values(ids.map(id=>({commonsId:trip,personId:id,role:id===traveler?"member" as const:"organizer" as const,status:"active" as const})));
  const memberCondition=and(eq(memberships.commonsId,trip),eq(memberships.personId,org));
  try{
    const link=(await manageGroupInvitation(trip,{commandId:randomUUID(),action:"create",expectedVersion:0,scopeAccepted:true,expiresInDays:14},options))!,token=link.token!;
    const body={commandId:randomUUID(),tripId:trip,linkId:link.id,version:link.version},identity={authUserId:traveler,email:`${traveler}@example.com`,displayName:"Traveler"};
    for(const change of [{role:"member" as const,status:"active" as const,attendanceState:"helping" as const},{role:"organizer" as const,status:"removed" as const,attendanceState:"helping" as const},{role:"organizer" as const,status:"active" as const,attendanceState:"declined" as const}]){
      await db.db.update(memberships).set(change).where(memberCondition);
      assert.equal(await getGroupInvitationPreview(token,url,new Date(),creatorCheck),null);
      await assert.rejects(joinGroupInvitation(token,identity,body,url,creatorCheck),/no longer available/);
      const managed=await getGroupInvitation(trip,{...options,actorPersonId:coOrg});assert.equal(managed!.state,"revoked");assert.equal(managed!.token,null);
      await db.db.update(memberships).set({role:"organizer",status:"active",attendanceState:"helping"}).where(memberCondition);
    }
    creatorEligible=false;
    assert.equal(await getGroupInvitationPreview(token,url,new Date(),creatorCheck),null);
    await assert.rejects(joinGroupInvitation(token,identity,body,url,creatorCheck),/no longer available/);
    const replacement=(await manageGroupInvitation(trip,{commandId:randomUUID(),action:"replace",expectedVersion:link.version,scopeAccepted:true,expiresInDays:14},{...options,actorPersonId:coOrg}))!;
    assert.equal(replacement.state,"active");assert.notEqual(replacement.token,token);
    assert.equal(await getGroupInvitationPreview(token,url,new Date(),creatorCheck),null);
    assert.ok(await getGroupInvitationPreview(replacement.token!,url,new Date(),creatorCheck));
    assert.equal((await db.db.select().from(memberships).where(and(eq(memberships.commonsId,trip),eq(memberships.personId,traveler))))[0].status,"active");
  }finally{await db.db.delete(commons).where(eq(commons.id,trip));await db.db.delete(people).where(inArray(people.id,ids));await db.close();}
});

test("creator membership is locked through granting access and provider eligibility is rechecked after preview",{skip},async()=>{
  const url=process.env.TEST_DATABASE_URL!;assert.equal(new URL(url).hostname,"127.0.0.1");assert.ok(new URL(url).pathname.endsWith("_test"));
  const db=createDatabase(url),trip=randomUUID(),ids=[randomUUID(),randomUUID(),randomUUID()],[org,traveler,coOrg]=ids;
  const options={databaseUrl:url,actorPersonId:org};
  await db.db.insert(people).values(ids.map(id=>({id,authUserId:id,displayName:"Synthetic member"})));
  await db.db.insert(commons).values({id:trip,slug:trip,name:"Creator race synthetic",createdByPersonId:org,timezone:"America/Denver"});
  await db.db.insert(memberships).values(ids.filter(id=>id!==traveler).map(id=>({commonsId:trip,personId:id,role:"organizer" as const,status:"active" as const})));
  let release=()=>{};
  try{
    const link=(await manageGroupInvitation(trip,{commandId:randomUUID(),action:"create",expectedVersion:0,scopeAccepted:true,expiresInDays:14},options))!;
    const input=()=>({commandId:randomUUID(),tripId:trip,linkId:link.id,version:link.version}),identity={authUserId:traveler,email:`${traveler}@example.com`,displayName:"Traveler"};
    let calls=0;
    await assert.rejects(joinGroupInvitation(link.token!,identity,input(),url,async()=>++calls===1),/no longer available/,"preview verification is not sufficient");
    assert.equal(calls,2);
    assert.equal((await db.db.select().from(memberships).where(and(eq(memberships.commonsId,trip),eq(memberships.personId,traveler)))).length,0);
    const entered=Promise.withResolvers<void>(),hold=Promise.withResolvers<void>();release=()=>hold.resolve();calls=0;
    const joining=joinGroupInvitation(link.token!,identity,input(),url,async()=>{if(++calls===2){entered.resolve();await hold.promise;}return true;});
    await entered.promise;
    let demoted=false;
    const demotion=db.db.update(memberships).set({role:"member"}).where(and(eq(memberships.commonsId,trip),eq(memberships.personId,org))).then(()=>{demoted=true;});
    await new Promise(resolve=>setTimeout(resolve,40));assert.equal(demoted,false,"removal/demotion cannot cross the locked authorization boundary");
    release();await joining;await demotion;
    assert.equal(await getGroupInvitationPreview(link.token!,url),null);
    await assert.rejects(joinGroupInvitation(link.token!,identity,input(),url),/no longer available/);
  }finally{release();await db.db.delete(commons).where(eq(commons.id,trip));await db.db.delete(people).where(inArray(people.id,ids));await db.close();}
});
