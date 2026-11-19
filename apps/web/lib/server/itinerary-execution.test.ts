import test from "node:test";
import assert from "node:assert/strict";
import { assertCompleteGeneratedProse, createOpenAIItineraryAdapter, type ItineraryExecutionInput } from "./itinerary-execution";

const request: ItineraryExecutionInput = { priceFreshness: "reference_only_unverified", privateDecisionState: "withheld", researchExecution: "not_requested", request: "Prepare a synthetic weekend", facts: {}, corrections: [], correctionSources: [], imports: [], content: {}, savedCandidateIds: [], evidence: [], coverage: { historyComplete: true, instructions: 0, archivedSources: 0, projectedSources: 0, excerptsTruncated: false } };
const content = { title: "Synthetic weekend", brief: "Draft only", items: [], driverBrief: "", tasks: [], unresolved: [] };

test("caller Stop and provider deadline still abort an in-flight itinerary", async t => {
  for (const reason of ["stop", "deadline"]) {
    const caller = new AbortController(), deadline = new AbortController();
    const mock = t.mock.method(AbortSignal, "timeout", () => deadline.signal);
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const adapter = createOpenAIItineraryAdapter({ apiKey: "synthetic", model: "gpt-6.1-sol", fetcher: async (_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
      entered();
    }) });
    const result = adapter(request, caller.signal);
    const rejected = assert.rejects(result, { name: "AbortError" });
    await started;
    (reason === "stop" ? caller : deadline).abort();
    await rejected;
    mock.mock.restore();
  }
});


test("cutoff provider prose cannot be saved, while complete sentences at the bound remain valid", () => {
  const item = { id:"saturday",kind:"activity" as const,title:"Saturday outing",day:"2026-11-14",time:"14:00",endTime:"16:30",location:"Santa Fe",note:"",participantNote:"",participation:"group" as const,alternative:false,evidence:"suggestion" as const,sources:[],unresolved:[] as string[] };
  const draft = { ...content, items:[item] };
  item.participantNote = "A".repeat(987) + " in our that ";
  assert.equal(item.participantNote.length,1000);
  assert.throws(()=>assertCompleteGeneratedProse(draft),/provider_failed/);
  item.participantNote = "A".repeat(999) + ".";
  assert.doesNotThrow(()=>assertCompleteGeneratedProse(draft));
  item.unresolved = ["A".repeat(295)+" that"];
  assert.throws(()=>assertCompleteGeneratedProse(draft),/provider_failed/);
  item.unresolved = ["Capacity for six and date-specific availability need confirmation."];
  item.participantNote = "Choose Meow Wolf, O'Keeffe Museum or a Canyon Road gallery. Published reference prices are not a group quote. Hours and availability for November 14 need confirmation. Dinner stays at 6:30 PM.";
  assert.doesNotThrow(()=>assertCompleteGeneratedProse(draft));
});


test("retained human/legacy text at a limit cannot block an unrelated wording edit",()=>{
 const original={...content,opening:"A".repeat(1000),driverBrief:"B".repeat(2000),unresolved:["C".repeat(300)]};
 const changed={...original,title:"Revised title"};
 assert.doesNotThrow(()=>assertCompleteGeneratedProse(changed,original));
 assert.throws(()=>assertCompleteGeneratedProse({...changed,driverBrief:"D".repeat(2000)},original),/provider_failed/);
});


test("focused adapter edits preserve an untouched legacy field at its bound",async()=>{
 const original={...content,opening:"Before.",driverBrief:"B".repeat(2000)};
 const adapter=createOpenAIItineraryAdapter({apiKey:"synthetic",model:"gpt-6.1-sol",originalContent:original,fetcher:async()=>Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({edits:[{id:"opening",text:"A warmer opening."}]})}}]})});
 const result=await adapter({...request,request:"Make the opening warmer",content:original});
 assert.equal(result.opening,"A warmer opening.");assert.equal(result.driverBrief,original.driverBrief);
});
