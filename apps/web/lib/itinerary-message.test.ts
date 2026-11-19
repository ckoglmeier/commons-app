import test from "node:test";
import assert from "node:assert/strict";
import { itineraryParticipantDraft } from "@commons/contracts";
import { detailedSonomaItinerary, sonomaMessageOutline } from "../../../packages/contracts/src/fixtures/sonoma-message";
import { itineraryMessageContent, itineraryMessageHtml, itineraryMessageText } from "./itinerary-message";
import { publishedPollHtml, publishedPollMessage } from "./coordinator-sharing";
import { renderPollEmail } from "./email/poll-email";

test("warm outline, copy and supported email share one participant snapshot and preserve safe links",()=>{
  const detailed=detailedSonomaItinerary(), outline=sonomaMessageOutline(detailed);
  const data=itineraryParticipantDraft(outline,()=>crypto.randomUUID());
  data.communication!.links=[{label:"Home base",url:"https://example.test/lodge"}];
  const before=JSON.stringify(data), text=itineraryMessageText(data)!, html=itineraryMessageHtml(data)!;
  assert.match(text,/A few days in wine country together!/); assert.match(text,/The Lodge at Sonoma/);
  for(const day of ["Thursday, November 5","Friday, November 6","Saturday, November 7"]) assert.match(text,new RegExp(day));
  for(const label of ["Flowers","DaVero","Lunch in Healdsburg","Dinner in Sonoma","Yoga","A hike"]) assert.ok(text.includes(label));
  assert.equal((text.match(/does not publicly offer Saturday tours/g)??[]).length,1,"preserve the specific supplied caveat once, rather than generic availability");
  assert.doesNotMatch(text,/Optional tasting en route \(optional\)/);
  assert.equal(itineraryMessageContent(data)!.questions.length,2);
  assert.match(text,/Home base: https:\/\/example.test\/lodge/); assert.match(html,/href="https:\/\/example.test\/lodge"/);
  assert.match(text,/What would you change or add/);
  assert.doesNotMatch(text,/Time open|Day open|PRIVATE_|1:12|2:30|Driver|Tasks|Draft \d|Nothing was booked/);
  assert.equal(detailed.items.find(item=>item.id==="arrival")!.time,"13:12","projection does not rewrite input anchors");
  const url="https://www.commons.travel/c/poll/abcdef012345", email=renderPollEmail("https://www.commons.travel","abcdef012345",data);
  assert.equal(email.text,publishedPollMessage(data,url)); assert.equal(email.text,`${text}\n\nRespond in Commons: ${url}`);
  assert.ok(email.html.includes(html)); assert.ok(publishedPollHtml(data,url).includes(html));
  assert.equal(JSON.stringify(data),before,"all renderers read the immutable snapshot");
});
test("outline HTML escapes prose and rejects executable links while legacy ballots retain their original copy",()=>{
  const data=itineraryParticipantDraft(sonomaMessageOutline(detailedSonomaItinerary()),()=>crypto.randomUUID());
  data.communication!.paragraphs=['<img src=x onerror="bad()"> A & B'];
  assert.match(itineraryMessageHtml(data)!,/&lt;img/); assert.doesNotMatch(itineraryMessageHtml(data)!,/<img|onerror="bad/);
  data.communication!.links=[{label:"Bad",url:"javascript:alert(1)"}]; assert.throws(()=>itineraryMessageHtml(data));
  data.communication!.links=[]; const question=data.questions[0]; if(question.kind==="choice") delete question.itinerary!.feedbackMode;
  assert.equal(itineraryMessageText(data),null); assert.equal(itineraryMessageContent(data),null);
  assert.match(publishedPollMessage(data,"https://example.test/poll"),/Vote in Commons/);
});
