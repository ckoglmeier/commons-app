import test from "node:test";
import assert from "node:assert/strict";
import { PollWorkingDraftSchema } from "@commons/contracts";
import { newItineraryDraft } from "./itinerary-workshop";
import { publishItineraryDraft, type ItineraryPublicationAttempt } from "./itinerary-publication-client";
test("publication retry pins command to reviewed draft identity/version/access",async()=>{
 const draft=PollWorkingDraftSchema.parse({id:crypto.randomUUID(),version:2,data:newItineraryDraft("QA"),publishedPollId:null,updatedAt:new Date().toISOString()}), requests:Record<string,unknown>[]=[],pending:{current:ItineraryPublicationAttempt|null}={current:null};
 const original=globalThis.fetch;globalThis.fetch=async(_url,init)=>{requests.push(JSON.parse(String(init?.body)));return Response.json({error:"Temporary publication failure"},{status:503});};
 try {await assert.rejects(publishItineraryDraft("qa",draft,"invitees",pending));await assert.rejects(publishItineraryDraft("qa",draft,"invitees",pending));assert.deepEqual(requests[0],requests[1]);await assert.rejects(publishItineraryDraft("qa",{...draft,id:crypto.randomUUID()},"invitees",pending));assert.notEqual(requests[2].commandId,requests[1].commandId);await assert.rejects(publishItineraryDraft("qa",draft,"link",pending));assert.deepEqual(requests[3].publicationApproval,{approved:true,access:"link"});assert.notEqual(requests[3].commandId,requests[1].commandId);}finally{globalThis.fetch=original;}
});
