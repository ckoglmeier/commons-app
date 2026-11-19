import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {addCommonsPerson,invitations, invitationDeliveryAttempts, memberships} from "@commons/database";
import {databaseTestsEnabled,eq,withCoordinatorScenario,withTestDatabase} from "./coordinator-route-harness";
const skip=!databaseTestsEnabled;
const options={environment:{COMMONS_EMAIL_SEND_MODE:"disabled"}};
const rows=(id:string)=>withTestDatabase(async db=>({invites:await db.select().from(invitations).where(eq(invitations.commonsId,id)),deliveries:await db.select().from(invitationDeliveryAttempts).where(eq(invitationDeliveryAttempts.commonsId,id)),members:await db.select().from(memberships).where(eq(memberships.commonsId,id))}));

test("Coordinator invites exact recipients atomically as Travelers; replay and repeated requests send no duplicates",{skip},()=>withCoordinatorScenario(async s=>{
  const first=`invite-${randomUUID()}@example.com`,second=`invite-${randomUUID()}@example.com`;
  const command=s.command({text:`Please invite Alice <${first}>, ${second}, ${first}`});
  const result=await s.post(command);assert.equal(result.status,200,JSON.stringify(result.body));
  assert.equal(result.body.capability,"invite_people");assert.match(result.body.durableAnswer,/Queued invitation emails as Travelers/);
  const saved=await rows(s.trip.eventId);assert.equal(saved.invites.length,2);assert.equal(saved.deliveries.length,2);
  assert.ok(saved.invites.every(row=>[first,second].includes(row.recipientEmail!)));
  assert.ok(saved.invites.every(invite=>saved.members.some(member=>member.personId===invite.provisionalPersonId&&member.role==="member"&&member.status==="invited")));
  const replay=await s.post(command);assert.equal(replay.status,200);assert.equal((await rows(s.trip.eventId)).deliveries.length,2);
  const again=await s.post(s.command({text:`Invite ${first}, ${second}`}));assert.match(again.body.durableAnswer,/Already invited/);assert.equal((await rows(s.trip.eventId)).deliveries.length,2);
  assert.equal(s.network.providerCalls.length,0);
},options));

test("invalid lists and non-organizers cannot invite; no partial recipient writes",{skip},()=>withCoordinatorScenario(async s=>{
  const email=`invite-${randomUUID()}@example.com`;
  const invalid=await s.post(s.command({text:`Invite ${email}, bad@`}));assert.equal(invalid.status,200);assert.match(invalid.body.durableAnswer,/no invitations were created/i);assert.equal((await rows(s.trip.eventId)).invites.length,0);
  const blocked=await s.post(s.command({text:`Invite ${email}`}),s.trip.travelerId);assert.equal(blocked.status,403);assert.equal((await rows(s.trip.eventId)).deliveries.length,0);
},options));

test("an invitation request can ask for a list, then accept the same organizer's immediate address-only answer",{skip},()=>withCoordinatorScenario(async s=>{
  const ask=await s.post(s.command({text:"Invite these people"}));assert.equal(ask.status,200);assert.match(ask.body.durableAnswer,/Paste the email addresses/);
  const email=`invite-${randomUUID()}@example.com`;
  const answer=await s.post(s.command({text:email,target:{kind:"existing",threadId:ask.body.thread.id,expectedTurnVersion:ask.body.thread.turnVersion}}));
  assert.equal(answer.status,200,JSON.stringify(answer.body));assert.equal((await rows(s.trip.eventId)).invites.length,1);assert.equal(s.network.providerCalls.length,0);
},options));


test("only requested unsent Traveler invitations are queued; pending Organizer grants are preserved but never sent by this flow",{skip},()=>withCoordinatorScenario(async s=>{
  const traveler=`invite-${randomUUID()}@example.com`,organizer=`invite-${randomUUID()}@example.com`,other=`invite-${randomUUID()}@example.com`;
  for(const [email,role] of [[traveler,"member"],[organizer,"organizer"],[other,"member"]]) await addCommonsPerson(s.trip.eventId,{displayName:email,email,role},{databaseUrl:process.env.TEST_DATABASE_URL,actorPersonId:s.trip.organizerId});
  const result=await s.post(s.command({text:`Invite ${traveler}, ${organizer}`}));assert.equal(result.status,200);
  const saved=await rows(s.trip.eventId);assert.equal(saved.deliveries.length,1);
  assert.equal(saved.deliveries[0].invitationId,saved.invites.find(invite=>invite.recipientEmail===traveler)?.id);
  assert.match(result.body.durableAnswer,/Already invited/);
},options));

test("concurrent requests for one address queue one email, and active members are not invited again",{skip},()=>withCoordinatorScenario(async s=>{
  const email=`invite-${randomUUID()}@example.com`;
  const results=await Promise.all([s.post(s.command({text:`Invite ${email}`})),s.post(s.command({text:`Invite ${email}`}))]);assert.ok(results.every(result=>result.status===200));
  const saved=await rows(s.trip.eventId);assert.equal(saved.invites.length,1);assert.equal(saved.deliveries.length,1);
  await withTestDatabase(db=>db.update(memberships).set({status:"active"}).where(eq(memberships.personId,saved.invites[0].provisionalPersonId!)));
  const again=await s.post(s.command({text:`Invite ${email}`}));assert.match(again.body.durableAnswer,/Already on this trip/);assert.equal((await rows(s.trip.eventId)).deliveries.length,1);
},options));


test("a different organizer's address-only follow-up cannot inherit invitation authority",{skip},()=>withCoordinatorScenario(async s=>{
  const ask=await s.post(s.command({text:"Invite them"}));
  const result=await s.post(s.command({text:`invite-${randomUUID()}@example.com`,target:{kind:"existing",threadId:ask.body.thread.id,expectedTurnVersion:ask.body.thread.turnVersion}}),s.trip.coOrganizerId);
  assert.equal(result.status,200);assert.equal((await rows(s.trip.eventId)).invites.length,0);assert.match(result.body.durableAnswer,/Please ask me to invite/);
},options));

test("invite them can use only the requesting organizer's immediately preceding address-only message",{skip},()=>withCoordinatorScenario(async s=>{
  const email=`invite-${randomUUID()}@example.com`;
  const list=await s.post(s.command({text:email}));assert.equal((await rows(s.trip.eventId)).invites.length,0);
  const result=await s.post(s.command({text:"Please invite them",target:{kind:"existing",threadId:list.body.thread.id,expectedTurnVersion:list.body.thread.turnVersion}}));
  assert.equal(result.status,200);assert.equal((await rows(s.trip.eventId)).invites[0]?.recipientEmail,email);
},options));

test("a deferred or organizer-role request does not authorize a later bare list",{skip},()=>withCoordinatorScenario(async s=>{
  const email=`invite-${randomUUID()}@example.com`;
  const ask=await s.post(s.command({text:`Invite ${email} as an organizer`}));
  const answer=await s.post(s.command({text:email,target:{kind:"existing",threadId:ask.body.thread.id,expectedTurnVersion:ask.body.thread.turnVersion}}));
  assert.equal(answer.status,200);assert.equal((await rows(s.trip.eventId)).invites.length,0);
},options));

test("Robin regression: adding named travelers prepares review, including an unclosed final bracket; approval queues exact recipients",{skip},()=>withCoordinatorScenario(async s=>{
 const first=`robin-regression-${randomUUID()}@example.com`,second=`robin-regression-${randomUUID()}@example.com`;
 const result=await s.post(s.command({text:`Please add these people as travelers: Ashley Synthetic <${first}>,\nLaura Synthetic <${second}`}));
 assert.equal(result.status,200);assert.equal(result.body.capability,"invite_people");assert.match(result.body.durableAnswer,/Review these travelers/);assert.equal((await rows(s.trip.eventId)).invites.length,0);
 const approved=await s.post(s.command({text:`Invite Ashley Synthetic <${first}>, Laura Synthetic <${second}>`,target:{kind:"existing",threadId:result.body.thread.id,expectedTurnVersion:result.body.thread.turnVersion}}));
 assert.match(approved.body.durableAnswer,/Queued invitation/);assert.equal((await rows(s.trip.eventId)).deliveries.length,2);assert.equal(s.network.providerCalls.length,0);
},options));
