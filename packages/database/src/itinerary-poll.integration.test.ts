import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { itineraryDecisionLabels } from "@commons/contracts";
import { createDatabase } from "./client";
import { commons, memberships, people, pollDeliveries } from "./schema";
import { saveCommonsPollDraft } from "./poll-draft-repository";
import { createCommonsPoll, getCommonsPollDetail, getPublicPollByPublicId, submitPublicPollResponseByPublicId, normalizePollAnswers, pollAnswersForViewer } from "./poll-repository";
import { getCommonsSnapshot } from "./pilot-repository";

const itemId=randomUUID(),ideaId=randomUUID();
const question={id:randomUUID(),kind:"choice" as const,prompt:"How does this itinerary work for you?",required:false,selectionMode:"single" as const,options:itineraryDecisionLabels.map(label=>({id:randomUUID(),label,description:null,exclusive:false})),itinerary:{title:"Synthetic weekend",days:[{id:randomUUID(),label:"Thursday",description:"",items:[{id:itemId,title:"Dinner in Sonoma",time:"7:30",details:"Table for nine",kind:"meal" as const,venue:"",status:"tentative" as const}]}],otherIdeas:[{id:ideaId,title:"Yoga",details:"If it fits"}]}};
test("comment-only and optional interest do not imply overall approval; private feedback is organizer-only",()=>{
  const answers=normalizePollAnswers([question],[{questionId:question.id,optionIds:[],text:null,itineraryFeedback:{comments:[{id:randomUUID(),itemId,text:"Try dinner outdoors"}],interests:[{itemId:ideaId,choice:"yes"}]}}]);
  assert.equal(answers.length,1);assert.deepEqual(answers[0].optionIds,[]);
  assert.equal(pollAnswersForViewer(answers,"transparent",false)?.[0].itineraryFeedback,undefined);
  assert.equal(pollAnswersForViewer(answers,"transparent",true)?.[0].itineraryFeedback?.comments.length,1);
  assert.throws(()=>normalizePollAnswers([question],[{...answers[0],itineraryFeedback:{comments:[],interests:[{itemId,choice:"yes"}]}}]));
});
test("piece votes survive normalization without comments, interests or an overall ballot",()=>{
  const optionId=randomUUID();
  const pieceQuestion={...question,options:[],itinerary:{...question.itinerary,feedbackMode:"pieces" as const,days:[{...question.itinerary.days[0],items:[{...question.itinerary.days[0].items[0],choices:{question:"Which stop?",options:[{id:optionId,label:"Garden"},{id:randomUUID(),label:"Skip"}]}}]}]}};
  const feedback={comments:[],interests:[],votes:[{itemId,optionId}]};
  const answers=normalizePollAnswers([pieceQuestion],[{questionId:question.id,optionIds:[],text:null,itineraryFeedback:feedback}]);
  assert.equal(answers.length,1);
  assert.deepEqual(answers[0].itineraryFeedback,feedback);
  assert.deepEqual(answers[0].optionIds,[]);
  assert.equal(pollAnswersForViewer(answers,"transparent",false)?.[0].itineraryFeedback,undefined);
  assert.deepEqual(pollAnswersForViewer(answers,"transparent",true)?.[0].itineraryFeedback,feedback);
});
test("saved itinerary publication, cross-viewer feedback, revision and approval boundaries",{skip:process.env.COMMONS_RUN_DATABASE_TESTS!=="1"},async()=>{
  const url=process.env.TEST_DATABASE_URL!;assert.ok(["127.0.0.1","localhost","[::1]"].includes(new URL(url).hostname));
  const db=createDatabase(url),event=randomUUID(),org=randomUUID(),member=randomUUID(),outsider=randomUUID();
  const options={databaseUrl:url,actorPersonId:org};
  try {
    await db.db.insert(people).values([org,member,outsider].map(id=>({id,displayName:"Synthetic itinerary QA",authUserId:id})));
    await db.db.insert(commons).values({id:event,slug:`qa-itinerary-${event}`,name:"Synthetic itinerary QA",createdByPersonId:org,timezone:"America/Denver"});
    await db.db.insert(memberships).values([{commonsId:event,personId:org,role:"organizer",status:"active"},{commonsId:event,personId:member,role:"member",status:"active"}]);
    const data={title:"Synthetic weekend",intro:null,ballotMode:"transparent",communication:{heading:"Weekend",paragraphs:["What works for you?"],links:[]},itinerarySource:"PRIVATE SOURCE",questions:[question]};
    await assert.rejects(saveCommonsPollDraft(event,{id:randomUUID(),commandId:randomUUID(),expectedVersion:0,data},{...options,actorPersonId:member}));
    const draft=await saveCommonsPollDraft(event,{id:randomUUID(),commandId:randomUUID(),expectedVersion:0,data},options);
    const publish={title:data.title,intro:null,ballotMode:data.ballotMode,communication:data.communication,questions:[question],commandId:randomUUID(),draftId:draft.id,draftVersion:draft.version,publicationApproval:{approved:true,access:"link"}};
    await assert.rejects(createCommonsPoll(event,publish,{...options,actorPersonId:member}));
    const poll=await createCommonsPoll(event,publish,options);assert.equal((await createCommonsPoll(event,publish,options)).id,poll.id);
    assert.equal((await db.db.select().from(pollDeliveries).where(eq(pollDeliveries.pollId,poll.id))).length,0);
    const publicPoll=await getPublicPollByPublicId(poll.publicId,url);assert.ok(publicPoll);assert.ok(!JSON.stringify(publicPoll).includes("PRIVATE SOURCE"));
    const comment={id:randomUUID(),itemId,text:"For dinner, try the plaza."};
    const ballot={respondentName:"Taylor",newReceiptToken:randomUUID()+randomUUID(),answers:[{questionId:question.id,optionIds:[question.options[1].id],text:null,itineraryFeedback:{comments:[comment],interests:[{itemId:ideaId,choice:"yes"}]}}]};
    const first=await submitPublicPollResponseByPublicId(poll.publicId,ballot,url);
    await submitPublicPollResponseByPublicId(poll.publicId,ballot,url);
    const updated={...ballot,receiptToken:first.receiptToken,expectedResponseUpdatedAt:first.responseUpdatedAt,answers:[{...ballot.answers[0],optionIds:[question.options[0].id]}]};
    const updatedReceipt=await submitPublicPollResponseByPublicId(poll.publicId,updated,url);
    const repeatedReceipt=await submitPublicPollResponseByPublicId(poll.publicId,updated,url);
    assert.equal(repeatedReceipt.responseUpdatedAt,updatedReceipt.responseUpdatedAt);
    await assert.rejects(submitPublicPollResponseByPublicId(poll.publicId,{...updated,answers:[{...ballot.answers[0],itineraryFeedback:{comments:[],interests:[]}}]},url),/another tab/);
    const detail=await getCommonsPollDetail(event,poll.id,options);assert.equal(detail?.responseCount,1);assert.equal(detail?.responses[0].answers?.[0].itineraryFeedback?.comments[0].text,comment.text);
    assert.deepEqual(detail?.responses[0].answers?.[0].optionIds,[question.options[0].id]);
    const memberDetail=await getCommonsPollDetail(event,poll.id,{...options,actorPersonId:member});assert.equal(memberDetail?.responses[0].answers?.[0].itineraryFeedback,undefined);
    await assert.rejects(getCommonsPollDetail(event,poll.id,{...options,actorPersonId:outsider}));
    // Invited access rejects anonymous visitors and unrelated identities.
    const restrictedDraft=await saveCommonsPollDraft(event,{id:randomUUID(),commandId:randomUUID(),expectedVersion:0,data},options);
    const restricted=await createCommonsPoll(event,{...publish,commandId:randomUUID(),draftId:restrictedDraft.id,draftVersion:restrictedDraft.version,publicationApproval:{approved:true,access:"invitees"}},options);
    assert.equal(await getPublicPollByPublicId(restricted.publicId,url),null);
    assert.equal(await getPublicPollByPublicId(restricted.publicId,url,{authUserId:outsider,email:"outsider@example.test"}),null);
    assert.ok(await getPublicPollByPublicId(restricted.publicId,url,{authUserId:member,email:"member@example.test"}));
    await submitPublicPollResponseByPublicId(restricted.publicId,{...ballot,newReceiptToken:randomUUID()+randomUUID()},url,{authUserId:member,email:"member@example.test"});
    const memberSnapshot = await getCommonsSnapshot(event,{...options,actorPersonId:member});
    assert.equal(memberSnapshot?.state.pollRequests?.find(item=>item.id===restricted.id)?.responded,true);
  } finally {await db.db.delete(commons).where(eq(commons.id,event));await db.db.delete(people).where(inArray(people.id,[org,member,outsider]));await db.close();}
});
