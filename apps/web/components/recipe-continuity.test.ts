import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import type { RecipeRunDetail } from "@commons/contracts";
import { createHookRenderer, registerComponentImportStubs, textOf } from "@/lib/test-support/hook-harness";
registerComponentImportStubs();

const fixture = (stage: RecipeRunDetail["stage"]): RecipeRunDetail => ({
  id: crypto.randomUUID(), title: "Places to stay", recipe: "lodging", workflow: { key: "lodging", version: 1 }, stage,
  draft: { id: crypto.randomUUID(), version: 4, published: true, archived: false },
  poll: { id: crypto.randomUUID(), publicId: "abc123abc123", status: "closed", responseCount: 6, superseded: false, audienceKind: "invitees", ballotMode: "transparent" },
  trip: { startsOn: "2027-04-15", endsOn: "2027-04-17", locationNames: ["Napa"] }, askedTrip: null,
  notes: [], evidenceFingerprint: null, outcome: null, headcount: null, history: [],
  properties: [], askAboutChildren: false, summary: null,
  context: { saved: null, changed: true, current: { version: 1, fingerprint: "a".repeat(64), trip: { startsOn: null, endsOn: null, locationNames: [] }, sources: [], attendance: null } },
});

test("closed and decided Goals expose a confirmed same-run revision even when context is missing or changed", async () => {
  const { RecipeRun } = await import("./recipe-run");
  const { GuidedGoalStages } = await import("./guided-goal-stages");
  const { GoalStages } = await import("./goal-stages");
  const { ReviseRoundControl } = await import("./recipe-shared");
  for (const stage of ["decide", "decided", "applied"] as const) {
    const run = fixture(stage), renderer = createHookRenderer({ expand: [RecipeRun, GuidedGoalStages, GoalStages] });
    try {
      renderer.render(createElement(RecipeRun, { slug: "qa", initial: run }));
      assert.equal(renderer.findAll(node => node.type === ReviseRoundControl).length, 2, "Revision is available from Build and the secondary Decide disclosure; only the open stage is visible");
    } finally { renderer.unmount(); }
  }
  const run = fixture("decide"), requests: Array<{ path: string; body: unknown }> = [];
  const renderer = createHookRenderer({ expand: [ReviseRoundControl] });
  try {
    renderer.render(createElement(ReviseRoundControl, { run, busy: false, runBase: `/recipes/${run.id}`,
      act: async work => { await work(); }, call: async (path, _method, body) => { requests.push({ path, body }); return { ok: true, data: {} as never }; },
    }));
    (renderer.find(node => node.type === "button" && textOf(node) === "Revise the draft").props.onClick as () => void)(); renderer.flush();
    assert.equal(requests.length, 0, "Opening confirmation cannot mutate the published round");
    assert.match(renderer.tree.map(textOf).join(" "), /earlier poll and answers stay as history/);
    (renderer.find(node => node.type === "button" && textOf(node) === "Start private revision").props.onClick as () => void)();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].path, `/recipes/${run.id}/revise`);
    assert.equal((requests[0].body as { expectedDraftVersion: number }).expectedDraftVersion, 4);
  } finally { renderer.unmount(); }
});

test("a saved lodging handoff labels its same earlier approval as being reconsidered without changing saved facts",async()=>{
  const {RecipeContextView}=await import("./recipe-context"),run=fixture("decided"),renderer=createHookRenderer({expand:[RecipeContextView]});
  const source={runId:crypto.randomUUID(),outcomeId:crypto.randomUUID(),decisionId:crypto.randomUUID(),pollId:crypto.randomUUID(),kind:"attendance" as const,status:"approved" as const,evidenceFingerprint:"a".repeat(64),currentEvidenceFingerprint:"a".repeat(64),approvedByName:"Casey",approvedAt:new Date().toISOString(),stale:[],conditions:[],needs:[]};
  const saved={...run.context!.current,sources:[source],attendance:{outcomeId:source.outcomeId,in:3,maybe:1,people:[]}};
  run.context={saved,current:{...saved,sources:[{...source,reconsidering:true}]},changed:true};
  try{
    renderer.render(createElement(RecipeContextView,{slug:"qa",run}));const text=renderer.tree.map(textOf).join(" ");
    assert.match(text,/Earlier approved attendance:.*3 recorded in/);assert.match(text,/being reconsidered in a new round/);
    assert.equal("reconsidering" in saved.sources[0],false);assert.equal(saved.attendance.in,3);
    run.context.current.sources[0].outcomeId=crypto.randomUUID();renderer.render(createElement(RecipeContextView,{slug:"qa",run}));
    assert.doesNotMatch(renderer.tree.map(textOf).join(" "),/being reconsidered in a new round/,"A different current approval must not be attributed to the saved source");
  }finally{renderer.unmount();}
});
