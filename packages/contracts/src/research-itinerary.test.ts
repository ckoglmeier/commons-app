import test from "node:test";
import assert from "node:assert/strict";
import { ItineraryDraftSchema, itineraryFeedbackContent, validateItineraryContent } from "./research-itinerary";
import { syntheticDraft } from "./fixtures/research-itinerary";
test("draft keeps authoritative Thursday–Saturday dates and distinct unknown times", () => {
  const draft = syntheticDraft(); ItineraryDraftSchema.parse(draft); validateItineraryContent(draft.content, draft);
  const bad = structuredClone(draft.content); bad.items[0].day = "2026-11-08";
  assert.throws(() => validateItineraryContent(bad, draft), /saved trip dates/);
});
test("duplicate identities, unsupported source claims and broken task links fail closed", () => {
  const draft = syntheticDraft();
  for (const mutate of [(d: typeof draft) => d.content.items.push(d.content.items[0]), (d: typeof draft) => d.content.items[0].evidence = "researched_claim", (d: typeof draft) => d.content.tasks[0].itemId = "missing"]) {
    const changed = structuredClone(draft); mutate(changed); assert.throws(() => validateItineraryContent(changed.content, changed));
  }
});
test("same source ID from another run cannot support a claim; saved items cannot be silently overwritten", () => {
  const draft = syntheticDraft(), content = structuredClone(draft.content);
  content.items[0].sources = [{ runId: itineraryId(8), sourceId: "source1" }];
  draft.evidence = [{ runId: itineraryId(9), sourceId: "source1", title: "Source", excerpt: "", url: "https://example.test", retrievedAt: new Date().toISOString() }];
  assert.throws(() => validateItineraryContent(content, draft), /Unknown research/);
  draft.receipts = [{ candidateId: "arrival-dinner", kind: "plan", savedId: itineraryId(7), commandId: itineraryId(6) }];
  const changed = structuredClone(draft.content); changed.items[0].title = "Changed after save";
  assert.throws(() => validateItineraryContent(changed, draft), /already saved/);
});
function itineraryId(n: number) { return `96000000-0000-4000-8000-00000000000${n}`; }

test("legacy saved candidates accept equivalent nullable fields but reject new public text, choices or timing", () => {
  const draft = syntheticDraft();
  draft.receipts = [{ candidateId: "arrival-dinner", kind: "plan", savedId: itineraryId(7), commandId: itineraryId(6) }];
  const compatible = structuredClone(draft.content);
  Object.assign(compatible.items[0], { endTime: null, travelAnchor: null, participantNote: null, venue: null, decision: null });
  validateItineraryContent(compatible, draft);
  for (const values of [{ participantNote: "New shared text" }, { venue: "New restaurant" }, { time: "19:00", endTime: "20:00" }, { decision: { question: "Where?", options: ["A", "B"] } }]) {
    const changed = structuredClone(compatible); Object.assign(changed.items[0], values);
    assert.throws(() => validateItineraryContent(changed, draft), /already saved/);
  }
});

test("core participant projection keeps time windows, open meals, piece choices and interests without private notes", async () => {
  const { itineraryParticipantDraft, ItineraryProviderContentSchema } = await import("./research-itinerary");
  const { CreatePollRequestSchema, itineraryFeedbackError } = await import("./index");
  const { randomUUID } = await import("node:crypto");
  const draft = syntheticDraft();
  draft.content.title = "Coastal weekend"; draft.content.brief = "PRIVATE BRIEF"; draft.content.driverBrief = "PRIVATE DRIVER";
  draft.content.items = [{ ...draft.content.items[0], id:"museum", title:"Museum or beach?", time:"10:00", endTime:"11:30", note:"PRIVATE NOTES", participantNote:"Choose a morning activity", decision:{question:"Which morning activity?",options:["Museum", "Beach", "Skip"]} },
    { ...draft.content.items[0], id:"lunch", title:"Lunch", kind:"meal", time:"12:00", note:"PRIVATE LUNCH", participantNote:"Suggest a lunch place", venue:null },
    { ...draft.content.items[0], id:"yoga", title:"Yoga", day:null, time:null, participation:"optional", note:"PRIVATE IDEA", participantNote:"Interested?" }];
  const ids = new Map<string,string>(), id=(key:string)=>{ if(!ids.has(key)) ids.set(key,randomUUID()); return ids.get(key)!; };
  const data = itineraryParticipantDraft(draft.content,id), question=data.questions[0]; assert.equal(question.kind,"choice"); if(question.kind!=="choice")return;
  const snapshot=question.itinerary!;
  assert.equal(snapshot.feedbackMode,"pieces"); assert.deepEqual(question.options,[]);
  assert.equal(snapshot.days[0].items[0].time,"10:00 AM–11:30 AM"); assert.equal(snapshot.days[0].items[1].venue,"");
  assert.equal(snapshot.otherIdeas[0].title,"Yoga"); assert.ok(!JSON.stringify(data).includes("PRIVATE"));
  assert.ok(CreatePollRequestSchema.safeParse({...data,commandId:randomUUID(),draftId:randomUUID(),draftVersion:1,publicationApproval:{approved:true}}).success);
  const item=snapshot.days[0].items[0], option=item.choices!.options[0];
  assert.equal(itineraryFeedbackError(snapshot,{comments:[],interests:[],votes:[{itemId:item.id,optionId:option.id}]}),null);
  const changed=structuredClone(draft.content); changed.items[0].decision!.options[0]="Different museum";
  const changedQ=itineraryParticipantDraft(changed,id).questions[0]; if(changedQ.kind!=="choice")return;
  assert.ok(itineraryFeedbackError(changedQ.itinerary,{comments:[],interests:[],votes:[{itemId:item.id,optionId:option.id}]}));
  assert.ok(itineraryFeedbackError(snapshot,{comments:[],interests:[],votes:[{itemId:item.id,optionId:option.id},{itemId:item.id,optionId:option.id}]}));
  // Provider objects require nullable fields; historical stored drafts need not.
  const schema=(await import("zod")).z.toJSONSchema(ItineraryProviderContentSchema);
  const candidate=(schema.properties!.items as {items:{required:string[];properties:Record<string,unknown>}}).items;
  assert.deepEqual(new Set(candidate.required),new Set(Object.keys(candidate.properties)));
});

test("feedback generation drops unsaved execution work while preserving exact saved Tasks and receipts", () => {
  const draft = syntheticDraft(), original = structuredClone(draft);
  assert.deepEqual(itineraryFeedbackContent(draft.content, draft).tasks, []);
  draft.receipts = [{ candidateId: draft.content.tasks[0].id, kind: "task", savedId: itineraryId(7), commandId: itineraryId(6) }];
  const changed = structuredClone(draft.content);
  changed.tasks[0].title = "A model tried to change a saved task";
  changed.tasks.push({ id: "new-assignment", title: "Book transport", itemId: null });
  const feedback = itineraryFeedbackContent(changed, draft);
  assert.deepEqual(feedback.tasks, [original.content.tasks[0]]);
  validateItineraryContent(feedback, draft);
  assert.equal(draft.receipts[0].savedId, itineraryId(7));
});
