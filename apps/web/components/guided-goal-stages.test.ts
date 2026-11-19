import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { buildAttendancePollData, type RecipeRunDetail, type DatesLocationRunDetail } from "@commons/contracts";
import { createHookRenderer, registerComponentImportStubs, textOf } from "@/lib/test-support/hook-harness";
import { installFakeLiveEnvironment, settle } from "@/lib/test-support/fake-live-transport";
registerComponentImportStubs();
const trip = { startsOn: "2027-04-15", endsOn: "2027-04-17", locationNames: ["Napa"] };
type Kind = "dates_location" | "attendance" | "lodging";
function runFor(recipe: Kind, stage: RecipeRunDetail["stage"] = "draft"): Exclude<RecipeRunDetail, { recipe: "food_preferences" }> {
  const data = buildAttendancePollData({ trip });
  return { id: crypto.randomUUID(), recipe, title: "Synthetic Goal", stage, draft: { id: crypto.randomUUID(), version: 2, published: stage !== "draft", archived: false },
    trip, askedTrip: trip, participantPreview: data, publicationAudience: ["Casey Synthetic"], summary: null, context: null, notes: [], history: [], outcome: null,
    poll: stage === "draft" ? null : { id: crypto.randomUUID(), publicId: "abc123abc123", status: ["shared", "collecting"].includes(stage) ? "open" : "closed", responseCount: stage === "shared" ? 0 : 1, superseded: false, audienceKind: "invitees", ballotMode: "transparent" },
    properties: [], askAboutChildren: false, headcount: null, alternatives: [], configuration: null, questions: [], advice: null, connectedEvidence: null,
  } as unknown as ReturnType<typeof runFor>;
}

test("each guided draft keeps edits mounted across Build/Share/Decide and blocks unsaved publication", async () => {
  const { GuidedGoalStages } = await import("./guided-goal-stages"), { GoalStages } = await import("./goal-stages");
  const { AttendanceDraft } = await import("./recipe-attendance"), { LodgingDraft } = await import("./recipe-lodging"), { DatesLocationDraft } = await import("./recipe-dates-location"), { RecipeConvergenceEditor } = await import("./recipe-convergence-editor"), { PublishPanel } = await import("./recipe-shared");
  for (const kind of ["dates_location", "attendance", "lodging"] as const) {
    const renderer = createHookRenderer({ expand: [GuidedGoalStages, GoalStages, AttendanceDraft, LodgingDraft, DatesLocationDraft, RecipeConvergenceEditor, PublishPanel] });
    let writes = 0;
    try {
      renderer.render(createElement(GuidedGoalStages, { slug: "qa", run: runFor(kind), busy: false, runBase: "/run", draftEpoch: 0, draftDirty: false, onDirtyChange: () => {}, goalBuild: createElement("p", {}, "Editable goal belongs here"), act: async () => { writes++; }, call: async () => { throw new Error("No call expected"); } })); renderer.flush();
      const stage = (name: string) => renderer.find(n => n.type === "button" && n.props["aria-label"] === name);
      assert.equal(stage("Build").props["aria-expanded"], true, kind);
      assert.equal(stage("Share").props["aria-expanded"], false, kind);
      assert.match(textOf(renderer.find(n => n.type === "div" && n.props.className === "goal-stage__body" && n.props.hidden === false)), /Editable goal belongs here/);
      const title = renderer.find(n => n.type === "input" && n.props.value === "Synthetic Goal");
      (title.props.onChange as (e: unknown) => void)({ target: { value: "Unsaved title" } }); renderer.flush();
      (stage("Share").props.onClick as () => void)(); renderer.flush();
      assert.equal(renderer.find(n => n.type === "button" && textOf(n) === "Share with the group").props.disabled, true, kind);
      (stage("Decide").props.onClick as () => void)(); renderer.flush();
      (stage("Build").props.onClick as () => void)(); renderer.flush();
      assert.equal(renderer.find(n => n.type === "input" && n.props.value === "Unsaved title").props.value, "Unsaved title", kind);
      assert.equal(writes, 0, "Switching stages cannot publish, approve or apply");
    } finally { renderer.unmount(); }
  }
});

test("published guided rounds keep sharing available after answers and closure without approving on navigation", async () => {
  const { GuidedGoalStages } = await import("./guided-goal-stages"), { GoalStages } = await import("./goal-stages");
  const { SavedPollShare, PollShareLink } = await import("./recipe-shared");
  const live = installFakeLiveEnvironment({ liveFetch: async () => Response.json({}) });
  Object.assign(window.location, { origin: "http://localhost" });
  let copied = ""; Object.assign(navigator, { clipboard: { writeText: async (s: string) => { copied = s; } } });
  try { for (const kind of ["dates_location", "attendance", "lodging"] as const) for (const phase of ["shared", "collecting", "decide", "closed"] as const) {
    const renderer = createHookRenderer({ expand: [GuidedGoalStages, GoalStages, SavedPollShare, PollShareLink] });
    try {
      renderer.render(createElement(GuidedGoalStages, { slug: "qa", run: runFor(kind, phase), busy: false, runBase: "/run", draftEpoch: 0, draftDirty: false, onDirtyChange: () => {}, act: async () => { throw new Error("No mutation expected"); }, call: async () => { throw new Error("No mutation expected"); } }));
      const share = renderer.find(n => n.type === "button" && n.props["aria-label"] === "Share");
      if (!share.props["aria-expanded"]) { (share.props.onClick as () => void)(); renderer.flush(); }
      await (renderer.find(n => n.type === "button" && textOf(n) === "Copy poll link").props.onClick as () => Promise<void>)(); renderer.flush();
      assert.equal(copied, "http://localhost/c/poll/abc123abc123");
      assert.equal(textOf(renderer.find(n => n.props.role === "status")), "Copied");
    } finally { renderer.unmount(); }
  } } finally { live.restore(); }
});

test("approved dates require a separate explicit exact-scope Update the trip command inside Decide", async () => {
  const { GuidedGoalStages } = await import("./guided-goal-stages"), { GoalStages } = await import("./goal-stages"), { DatesLocationOutcome, DatesLocationOutcomeBody } = await import("./recipe-dates-location");
  const run = runFor("dates_location", "decided") as DatesLocationRunDetail;
  run.outcome = { id: crypto.randomUUID(), status: "approved", approvedByName: "Casey", stale: [], result: { kind: "dates_location", startsOn: "2027-05-01", endsOn: "2027-05-03", place: "Sonoma", basis: { acceptedCount: 1, respondedCount: 1, awaitingCount: 0 }, exceptions: [] } } as unknown as NonNullable<DatesLocationRunDetail["outcome"]>;
  const requests: Array<{ path: string; body: unknown }> = [];
  const renderer = createHookRenderer({ expand: [GuidedGoalStages, GoalStages, DatesLocationOutcome, DatesLocationOutcomeBody] });
  try {
    renderer.render(createElement(GuidedGoalStages, { slug: "qa", run, busy: false, runBase: "/run", draftEpoch: 0, draftDirty: false, onDirtyChange: () => {}, act: async work => { await work(); }, call: async <T,>(path: string, _method: string, body?: unknown) => { requests.push({ path, body }); return { ok: true as const, data: {} as T }; } }));
    const stage = (name: string) => renderer.find(n => n.type === "button" && n.props["aria-label"] === name);
    assert.equal(stage("Decide").props["aria-expanded"], true);
    for (const name of ["Build", "Share", "Decide"]) { (stage(name).props.onClick as () => void)(); renderer.flush(); }
    assert.equal(requests.length, 0);
    (renderer.find(n => n.type === "button" && textOf(n) === "Update the trip").props.onClick as () => void)();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].path, "/run/apply");
    const body = requests[0].body as { expected: typeof trip; outcomeId: string; applyDates: boolean; applyLocation: boolean };
    assert.deepEqual(body.expected, trip); assert.equal(body.outcomeId, run.outcome.id); assert.equal(body.applyDates, true); assert.equal(body.applyLocation, true);
  } finally { renderer.unmount(); }
});

test("late background collection refresh cannot restore an open round after explicit close", async () => {
  const { RecipeRun } = await import("./recipe-run"), { GuidedGoalStages } = await import("./guided-goal-stages");
  const open = runFor("attendance", "collecting"), closed = { ...open, stage: "decide" as const, poll: { ...open.poll!, status: "closed" as const } };
  let finishOld: (value: Response) => void = () => {}, gets = 0;
  const live = installFakeLiveEnvironment({ liveFetch: async (_url, init) => {
    if (init?.method === "PATCH") return Response.json({});
    if (++gets === 1) return new Promise<Response>(resolve => { finishOld = resolve; });
    return Response.json({ run: closed });
  } });
  Object.defineProperty(globalThis, "document", { value: { visibilityState: "visible" }, configurable: true });
  const renderer = createHookRenderer({ expand: [RecipeRun] });
  try {
    renderer.render(createElement(RecipeRun, { slug: "qa", initial: open }));
    window.dispatchEvent(new Event("focus")); await settle(2);
    const control = renderer.find(n => n.type === GuidedGoalStages);
    await (control.props.act as (work: () => Promise<{ok:true;data:unknown}>) => Promise<void>)(async () => ({ ok: true, data: {} }));
    renderer.flush();
    assert.equal((renderer.find(n => n.type === GuidedGoalStages).props.run as RecipeRunDetail).stage, "decide");
    finishOld(Response.json({ run: open })); await settle(3); renderer.flush();
    assert.equal((renderer.find(n => n.type === GuidedGoalStages).props.run as RecipeRunDetail).stage, "decide");
  } finally { renderer.unmount(); live.restore(); }
});
