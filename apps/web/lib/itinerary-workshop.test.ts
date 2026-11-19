import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CreatePollRequestSchema, PollDetailSchema, PollWorkingDataSchema, PollWorkingDraftSchema, itineraryFeedbackError } from "@commons/contracts";
import { normalizePollAnswers } from "@commons/database";
import { itineraryPublicationInput, itineraryQuestion, newItineraryDraft, parseItineraryText, isItineraryPaste, itineraryResults } from "./itinerary-workshop";
import { prepareCoordinatorProposal } from "./coordinator-proposal";

const supplied = `## Thursday: Arrival, Local Winery
| Time | Plan |
| ---- | ---- |
| 1:12 p.m. | Land at SFO |
| 4:00/4:15–5:30 | Private member-arranged Winery (likely Gundlach) experience |
| 7:30 | Dinner in downtown Sonoma |
## Friday: Healdsburg wineries
I would schedule only two substantive tastings.
### 10:00–11:30: Flowers
Book the **Estate Vineyard Immersion** if the group is comfortable with the $130 price.
### 11:45–1:30: Lunch in Healdsburg
Build in at least 90 minutes for nine people.
### 3:00–4:30: DaVero Pairing Experience
DaVero lists a large-group rate of $65 plus gratuity.
## Saturday: Schramsberg and SFO
| Time | Plan |
| ---- | ---- |
| 9:00 or 9:30 | Private Schramsberg cave tour and tasting |
| 1:30–2:00 | Arrive at SFO for 4:00 p.m. departure |`;

test("organizer results count normalized vote-only feedback without comments or interests",()=>{
  const data=newItineraryDraft("Weekend"),question=itineraryQuestion(data.questions)!;
  const snapshot=parseItineraryText("## Thursday\n- Optional winery","Weekend");
  const item=snapshot.days[0].items[0],optionId=randomUUID();
  item.choices={question:"Which winery?",options:[{id:optionId,label:"Gundlach Bundschu"},{id:randomUUID(),label:"Skip"}]};
  question.itinerary={...snapshot,feedbackMode:"pieces"};
  const answers=normalizePollAnswers([question],[{questionId:question.id,optionIds:[],text:null,itineraryFeedback:{comments:[],interests:[],votes:[{itemId:item.id,optionId}]}}]);
  const poll=PollDetailSchema.parse({id:randomUUID(),publicId:"abcdef012345",event:{slug:"synthetic",name:"Synthetic weekend",coverImageUrl:null},...data,status:"open",createdByName:"Organizer",responseCount:1,resultsVisible:true,aggregates:[],createdAt:new Date().toISOString(),shareToken:"synthetic-only-token-123456789",currentActorRole:"organizer",currentActorCanManage:true,responses:[{id:randomUUID(),respondentName:"Vote-only traveler",answers,updatedAt:new Date().toISOString()}]});
  const results=itineraryResults(poll)!;
  assert.equal(results.responses.length,1);
  assert.deepEqual(results.choices[0].options[0].people,["Vote-only traveler"]);
  assert.deepEqual(results.decisions,[]);
  assert.deepEqual(results.comments,[]);
  assert.deepEqual(results.ideas,[]);
});

test("supplied itinerary preserves days, order, times, details and prices without inventing commitments",()=>{
  const snapshot=parseItineraryText(supplied,"Wine weekend");
  assert.deepEqual(snapshot.days.map(day=>day.label),["Thursday: Arrival, Local Winery","Friday: Healdsburg wineries","Saturday: Schramsberg and SFO"]);
  assert.deepEqual(snapshot.days[1].items.map(item=>[item.time,item.title]),[["10:00–11:30","Flowers"],["11:45–1:30","Lunch in Healdsburg"],["3:00–4:30","DaVero Pairing Experience"]]);
  assert.equal(snapshot.days[1].description,"I would schedule only two substantive tastings.");
  assert.match(snapshot.days[1].items[0].details,/\$130/);
  assert.equal(snapshot.days[0].items.filter(item=>item.title.includes("Winery")).length,1);
  assert.equal(snapshot.days[1].items[1].kind,"meal");
  assert.ok(snapshot.days.flatMap(day=>day.items).every(item=>item.status==="tentative"));
  assert.deepEqual(snapshot.otherIdeas,[]);
});
test("publication projects the reviewed saved snapshot, never organizer source or conversation",()=>{
  const data=PollWorkingDataSchema.parse(newItineraryDraft("Wine weekend"));
  data.itinerarySource="PRIVATE SOURCE";
  data.settledFacts="PRIVATE TRIP CONTEXT";
  const question=itineraryQuestion(data.questions)!;
  question.itinerary={...parseItineraryText(supplied,data.title),feedbackMode:"pieces"};
  const draft=PollWorkingDraftSchema.parse({id:randomUUID(),version:1,data,publishedPollId:null,updatedAt:new Date().toISOString()});
  const input=itineraryPublicationInput(draft,randomUUID(),"invitees");
  assert.ok(CreatePollRequestSchema.safeParse(input).success);
  assert.ok(!JSON.stringify(input).includes("PRIVATE"));
  assert.equal(input.draftVersion,1);
  assert.equal(CreatePollRequestSchema.safeParse({...input,publicationApproval:undefined}).success,false);
  assert.equal(CreatePollRequestSchema.safeParse({...input,ballotMode:"secret"}).success,false);
  assert.equal(CreatePollRequestSchema.safeParse({...input,questions:[{...question,required:true}]}).success,false);
});
test("feedback binds to this published version and interest cannot target scheduled items",()=>{
  const snapshot=parseItineraryText(supplied,"Weekend"),item=snapshot.days[0].items[0].id,idea=randomUUID();
  snapshot.otherIdeas=[{id:idea,title:"Yoga",details:"If it fits"}];
  const feedback={comments:[{id:randomUUID(),itemId:item,text:"Later arrival"}],interests:[{itemId:idea,choice:"yes" as const}]};
  assert.equal(itineraryFeedbackError(snapshot,feedback),null);
  assert.ok(itineraryFeedbackError(snapshot,{...feedback,interests:[{itemId:item,choice:"yes"}]}));
  assert.ok(itineraryFeedbackError(snapshot,{...feedback,comments:[{...feedback.comments[0],itemId:randomUUID()}]}));
  assert.ok(itineraryFeedbackError(undefined,feedback));
});
test("generic poll edits cannot delete or restructure an itinerary object",()=>{
  const data=newItineraryDraft("Weekend"),question=data.questions[0];
  assert.throws(()=>prepareCoordinatorProposal(data,{reply:"Removed it",title:null,intro:null,message:null,edits:[],operations:[{kind:"remove_question",questionId:question.id}]},"Remove question",new Date().toISOString()),/Edit itinerary items directly/);
});
test("imports reject oversized day headings instead of truncating supplied text",()=>{
  assert.throws(()=>parseItineraryText(`## ${"a".repeat(101)}\n### 10:00: Flowers`,"Weekend"));
});
test("separate bulleted stops remain separate items",()=>{
  const itinerary=parseItineraryText("## Friday\n- Flowers\n- Lunch in Healdsburg\n- DaVero", "Weekend");
  assert.deepEqual(itinerary.days[0].items.map(item=>item.title),["Flowers","Lunch in Healdsburg","DaVero"]);
});

test("rendered clipboard plan preserves the same days/stops/times as Markdown", () => {
  const plain=supplied.replace(/^#{1,6} /gm, "").replace(/\*\*/g, "").split("\n").filter(line=>!/^\| ----/.test(line)).map(line=>line.startsWith("|") ? line.slice(1,-1).trim().split(/\s*\|\s*/).join("\t") : line).join("\n");
  const parsed=parseItineraryText(plain,"Wine weekend"), markdown=parseItineraryText(supplied,"Wine weekend");
  assert.deepEqual(parsed.days.map(day=>({label:day.label,description:day.description,items:day.items.map(item=>({time:item.time,title:item.title,details:item.details.replace(/\*\*/g,""),kind:item.kind,status:item.status,venue:item.venue}))})),markdown.days.map(day=>({label:day.label,description:day.description,items:day.items.map(item=>({time:item.time,title:item.title,details:item.details.replace(/\*\*/g,""),kind:item.kind,status:item.status,venue:item.venue}))})));
  assert.equal(isItineraryPaste(plain),true);
  assert.equal(isItineraryPaste("What do you think about Friday?\nWe have nine people."),false);
});
test("rich-text table cells, bullet symbols and optional ideas stay separate",()=>{
  const plan=parseItineraryText("Thursday: Arrival\nTime\nPlan\n1:12 PM\nLand at SFO\n7:30 PM\nDinner near the lodge\nFriday: Wine country\n• Flowers\n• Lunch in Healdsburg\nOther ideas if they fit\n• Yoga\nIf we have time", "Weekend");
  assert.deepEqual(plan.days.map(day=>day.items.map(item=>[item.time,item.title])),[[["1:12 PM","Land at SFO"],["7:30 PM","Dinner near the lodge"]],[["","Flowers"],["","Lunch in Healdsburg"]]]);
  assert.deepEqual(plan.otherIdeas.map(idea=>({title:idea.title,details:idea.details})),[{title:"Yoga",details:"If we have time"}]);
  assert.ok(plan.days.flatMap(day=>day.items).every(item=>item.status==="tentative"));
});

test("an orphan supplied time cannot disappear at a new day or optional ideas",()=>{
  for(const next of ["Friday\n7:00 PM Dinner","Other ideas if they fit\n• Yoga"]){
    assert.throws(()=>parseItineraryText(`Thursday\n2:00 PM\n${next}`,"Weekend"),/Add the activity after each time/);
  }
});
