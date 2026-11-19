import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { aggregatePollAnswers, buildDatesLocationPollData, summarizeAlternatives, type DatesLocationBlock, type DatesLocationConfiguration, type DatesLocationRunDetail } from "@commons/contracts";
import { createHookRenderer, registerComponentImportStubs, textOf } from "@/lib/test-support/hook-harness";
import type { Call } from "./recipe-shared";
import { installFakeLiveEnvironment, settle } from "@/lib/test-support/fake-live-transport";

registerComponentImportStubs();
// PostgreSQL JSONB does not preserve object property insertion order.
function jsonbOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(jsonbOrder);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, jsonbOrder(item)]));
  return value;
}
const kinds = ["dates", "location", "location_availability", "ranking", "allocation", "combination", "choice", "text"] as const;
for (const kind of kinds) test(`${kind}: saved v2 questions can publish after a JSONB round-trip`, async () => {
  const block: DatesLocationBlock = { id: crypto.randomUUID(), type: kind === "location_availability" ? "location" : kind, prompt: "Original question", required: kind !== "text", options: kind === "text" ? [] : Array.from({ length: 2 }, (_, index) => ({ id: crypto.randomUUID(),
    ...(kind === "dates" || kind === "combination" ? { startsOn: `2027-05-${10 + index}`, endsOn: `2027-05-${11 + index}` } : {}),
    ...(kind === "location" || kind === "location_availability" || kind === "ranking" || kind === "allocation" || kind === "combination" ? { place: ["Santa Fe", "Denver"][index] } : {}),
    ...(kind === "choice" ? { label: ["Own bed", "Shared bed"][index] } : {}),
  })), ...(kind === "ranking" || kind === "allocation" ? { dimension: "location" } : {}), ...(kind === "location_availability" ? { scale: "yes_maybe_no" } : {}), ...(kind === "choice" ? { selectionMode: "multiple" } : {}) };
  const configuration: DatesLocationConfiguration = { version: 2, blocks: [block] }, data = buildDatesLocationPollData({ configuration });
  let run: DatesLocationRunDetail = { id: crypto.randomUUID(), recipe: "dates_location", title: data.title, workflow: { key: "trip_feasibility", version: 1 }, stage: "draft", draft: { id: crypto.randomUUID(), version: 1, published: false, archived: false }, poll: null, notes: [], evidenceFingerprint: null, outcome: null, trip: { startsOn: null, endsOn: null, locationNames: [] }, askedTrip: null, headcount: null, history: [], alternatives: [], summary: null, questions: data.questions, configuration: jsonbOrder(configuration) as DatesLocationConfiguration };
  const { RecipeConvergenceEditor } = await import("./recipe-convergence-editor");
  const { PublishPanel } = await import("./recipe-shared");
  const renderer = createHookRenderer({ expand: [RecipeConvergenceEditor, PublishPanel] });
  const call: Call = async <T>(_path: string, _method: string, raw?: unknown) => {
    const body = raw as { title: string; configuration: DatesLocationConfiguration; expectedDraftVersion: number };
    const saved = buildDatesLocationPollData({ title: body.title, configuration: body.configuration, previous: { questions: run.questions ?? [] } });
    run = { ...run, title: saved.title, questions: saved.questions, configuration: jsonbOrder(saved.recipeConfiguration) as DatesLocationConfiguration, draft: { ...run.draft, version: run.draft.version + 1 } };
    return { ok: true, data: { draftVersion: run.draft.version } as T };
  };
  const act = async (work: () => Promise<unknown>) => { await work(); render(); };
  const render = () => renderer.render(createElement(RecipeConvergenceEditor, { run, busy: false, call, act, runBase: "/qa" }));
  const publish = () => renderer.find(node => node.type === "button" && textOf(node) === "Share with the group");
  try {
    render(); assert.equal(publish().props.disabled, false);
    const prompt = renderer.find(node => node.type === "input" && node.props.value === "Original question");
    (prompt.props.onChange as (event: unknown) => void)({ target: { value: "Revised question" } }); renderer.flush();
    assert.equal(publish().props.disabled, true, "private unsaved edits block publication");
    await (renderer.find(node => node.type === "button" && textOf(node) === "Save questions").props.onClick as () => Promise<void>)(); renderer.flush();
    assert.equal(publish().props.disabled, false, "schema-normalized saved equality ignores JSONB key order");
    assert.equal(renderer.findAll(node => node.type === "button" && textOf(node) === "Saved").length, 1);
    if (kind === "location_availability") { assert.match(renderer.tree.map(textOf).join(" "), /Destination availability/); assert.doesNotMatch(renderer.tree.map(textOf).join(" "), /Date availability · Required/); }
  } finally { renderer.unmount(); }
});

test("adopting advice rehydrates the accepted draft; conflict refresh preserves unsaved edits", async () => {
  const location: DatesLocationConfiguration = { version: 2, blocks: [{ id: crypto.randomUUID(), type: "location", prompt: "Old interest question", required: true, options: [{ id: crypto.randomUUID(), place: "Santa Fe" }, { id: crypto.randomUUID(), place: "Denver" }] }] };
  const proposed: DatesLocationConfiguration = { version: 2, blocks: [{ id: crypto.randomUUID(), type: "dates", prompt: "Suggested date availability", required: true, options: [{ id: crypto.randomUUID(), startsOn: "2027-05-10", endsOn: "2027-05-11" }, { id: crypto.randomUUID(), startsOn: "2027-05-12", endsOn: "2027-05-13" }] }] };
  const oldData = buildDatesLocationPollData({ configuration: location }), newData = buildDatesLocationPollData({ title: "Accepted recommendation", configuration: proposed });
  const sourcePollId = crypto.randomUUID(), fingerprint = "f".repeat(64);
  let serverRun: DatesLocationRunDetail = { id: crypto.randomUUID(), recipe: "dates_location", title: oldData.title, workflow: { key: "trip_feasibility", version: 1 }, stage: "draft", draft: { id: crypto.randomUUID(), version: 1, published: false, archived: false }, poll: null, notes: [], evidenceFingerprint: null, outcome: null, trip: { startsOn: null, endsOn: null, locationNames: [] }, askedTrip: null, headcount: null, history: [], alternatives: [], summary: null, questions: oldData.questions, configuration: location,
    advice: { version: 1, method: "rules", evidenceFingerprint: fingerprint, action: "prepare_questions", title: "A focused next question", reason: "Resolve missing dates", stoppingCondition: "Review feasibility", facts: [], unknowns: [], constraints: [], sourceFingerprints: [{ pollId: sourcePollId, fingerprint }], proposedConfiguration: proposed, estimatedDecisionsPerRespondent: 2, estimatedTotalDecisions: 0, suggestedAlternativeId: null },
    connectedEvidence: { runId: crypto.randomUUID(), commonsId: crypto.randomUUID(), fingerprint, complete: true, currentAudience: [], trip: { startsOn: null, endsOn: null, locationNames: [] }, draft: { id: crypto.randomUUID(), version: 1, published: false, questions: oldData.questions }, sources: [{ pollId: sourcePollId, round: 1, fingerprint, status: "closed", ballotMode: "transparent", audience: null, superseded: true, questions: [], responses: [], hiddenResponseCount: 0, approvedOutcome: null, resolvedNeeds: [] }] },
  };
  const initial = structuredClone(serverRun);
  const live = installFakeLiveEnvironment({ liveFetch: async (url, init) => {
    if (init?.method === "POST" && url.endsWith("/advice")) {
      serverRun = { ...serverRun, title: newData.title, configuration: proposed, questions: newData.questions, draft: { ...serverRun.draft, version: 2 } };
      return Response.json({ draftVersion: 2 });
    }
    if (init?.method === "POST" && url.endsWith("/alternatives")) {
      const remoteConfiguration = { ...proposed, blocks: proposed.blocks.map(block => ({ ...block, prompt: "Saved by another organizer" })) };
      serverRun = { ...serverRun, configuration: remoteConfiguration, questions: buildDatesLocationPollData({ configuration: remoteConfiguration }).questions, draft: { ...serverRun.draft, version: 3 } };
      return Response.json({ error: "This changed in another tab.", code: "conflict" }, { status: 409 });
    }
    return Response.json({ run: serverRun });
  } });
  const { RecipeRun } = await import("./recipe-run");
  const { DatesLocationDraft } = await import("./recipe-dates-location");
  const { RecipeConvergenceEditor } = await import("./recipe-convergence-editor");
  const { RecipeAdvicePanel } = await import("./recipe-advice");
  const { PublishPanel } = await import("./recipe-shared");
  const { GuidedGoalStages } = await import("./guided-goal-stages");
  const { GoalStages } = await import("./goal-stages");
  const renderer = createHookRenderer({ expand: [RecipeRun, GuidedGoalStages, GoalStages, DatesLocationDraft, RecipeConvergenceEditor, RecipeAdvicePanel, PublishPanel] });
  const adviceButton = () => renderer.find(node => node.type === "button" && textOf(node) === "Use these questions in the private draft");
  try {
    renderer.render(createElement(RecipeRun, { slug: "qa", initial })); renderer.flush();
    await (adviceButton().props.onClick as () => Promise<void>)(); await settle(5); renderer.flush();
    assert.equal(renderer.findAll(node => node.type === "input" && node.props.value === "Old interest question").length, 0);
    assert.equal(renderer.findAll(node => node.type === "input" && node.props.value === "Suggested date availability").length, 1);
    assert.equal(renderer.find(node => node.type === "button" && textOf(node) === "Share with the group").props.disabled, false);
    const prompt = renderer.find(node => node.type === "input" && node.props.value === "Suggested date availability");
    (prompt.props.onChange as (event: unknown) => void)({ target: { value: "Unsaved local question" } }); renderer.flush();
    assert.equal(adviceButton().props.disabled, true, "adoption cannot overwrite local edits");
    await (renderer.find(node => node.type === "button" && textOf(node) === "Save questions").props.onClick as () => Promise<void>)(); await settle(5); renderer.flush();
    assert.equal(renderer.findAll(node => node.type === "input" && node.props.value === "Unsaved local question").length, 1, "failed command refresh never remounts away unsaved edits");
    assert.match(renderer.tree.map(textOf).join(" "), /This changed in another tab/);
    assert.equal(renderer.find(node => node.type === "button" && textOf(node) === "Share with the group").props.disabled, true);
  } finally { renderer.unmount(); live.restore(); }
});

test("combination results state literal answer coverage and retain separate preference evidence", async () => {
  const configuration: DatesLocationConfiguration = { version: 2, blocks: [
    { id: crypto.randomUUID(), type: "combination", prompt: "Which combinations work?", required: true, options: [{ id: crypto.randomUUID(), startsOn: "2027-05-10", endsOn: "2027-05-11", place: "Santa Fe" }, { id: crypto.randomUUID(), startsOn: "2027-05-12", endsOn: "2027-05-13", place: "Denver" }] },
    { id: crypto.randomUUID(), type: "ranking", dimension: "location", prompt: "Rank destinations", required: false, options: [{ id: crypto.randomUUID(), place: "Santa Fe" }, { id: crypto.randomUUID(), place: "Denver" }] },
  ] };
  const data = buildDatesLocationPollData({ configuration }), alternatives = data.questions[0].kind === "choice" ? data.questions[0].options.flatMap(option => option.alternative ? [{ id: option.id, ...option.alternative }] : []) : [];
  const summary = summarizeAlternatives({ alternatives, audience: [{ key: "a", name: "Alex" }], responses: [{ key: "a", name: "Alex", acceptable: [alternatives[0].id], preferred: null, neither: false, hasNeed: true }] });
  const run: DatesLocationRunDetail = { id: crypto.randomUUID(), recipe: "dates_location", title: data.title, workflow: { key: "trip_feasibility", version: 1 }, stage: "collecting", draft: { id: crypto.randomUUID(), version: 1, published: true, archived: false }, poll: { id: crypto.randomUUID(), publicId: "qa", status: "open", responseCount: 1, superseded: false, audienceKind: "invitees", ballotMode: "transparent" }, notes: [], evidenceFingerprint: null, outcome: null, trip: { startsOn: null, endsOn: null, locationNames: [] }, askedTrip: null, headcount: null, history: [], alternatives, summary,
    ballotResults: { questions: data.questions, aggregates: data.questions.map(question => aggregatePollAnswers(question, [])), responseCount: 1, resultsVisible: true, identityBound: true },
  };
  const { DatesLocationOverlap } = await import("./recipe-dates-location");
  const { PollResults } = await import("./poll-results");
  const renderer = createHookRenderer({ expand: [DatesLocationOverlap, PollResults] });
  try {
    renderer.render(createElement(DatesLocationOverlap, { run }));
    const text = renderer.tree.map(textOf).join(" ");
    assert.match(text, /Selected as workable by everyone who answered/);
    assert.match(text, /Needs still require review/);
    assert.doesNotMatch(text, /Works for everyone asked/);
    assert.match(text, /Rank destinations/);
    assert.match(text, /Preferences aren’t availability/);
    assert.equal(summary.rows[0].preferredBy.length, 0, "ranking never becomes a legacy preferred vote");
  } finally { renderer.unmount(); }
});

test("date edits in one render batch retain all option values and become saveable", async () => {
  const configuration: DatesLocationConfiguration = { version: 2, blocks: [{ id: crypto.randomUUID(), type: "location", prompt: "Destinations", required: true, options: [{ id: crypto.randomUUID(), place: "Santa Fe" }, { id: crypto.randomUUID(), place: "Denver" }] }] };
  const data = buildDatesLocationPollData({ configuration });
  const run: DatesLocationRunDetail = { id: crypto.randomUUID(), recipe: "dates_location", title: data.title, workflow: { key: "trip_feasibility", version: 1 }, stage: "draft", draft: { id: crypto.randomUUID(), version: 2, published: false, archived: false }, poll: null, notes: [], evidenceFingerprint: null, outcome: null, trip: { startsOn: null, endsOn: null, locationNames: [] }, askedTrip: null, headcount: null, history: [], alternatives: [], summary: null, questions: data.questions, configuration };
  const { RecipeConvergenceEditor } = await import("./recipe-convergence-editor");
  const renderer = createHookRenderer({ expand: [RecipeConvergenceEditor] });
  const call: Call = async <T>() => ({ ok: true, data: {} as T });
  try {
    renderer.render(createElement(RecipeConvergenceEditor, { run, busy: false, call, act: async work => { await work(); }, runBase: "/qa" }));
    (renderer.find(node => node.type === "button" && textOf(node) === "Add date availability").props.onClick as () => void)(); renderer.flush();
    const dates = renderer.findAll(node => node.type === "input" && node.props.type === "date");
    const values = ["2026-11-05", "2026-11-07", "2026-11-06", "2026-11-08"];
    dates.forEach((node, index) => (node.props.onChange as (event: unknown) => void)({ target: { value: values[index] } }));
    renderer.flush();
    assert.deepEqual(renderer.findAll(node => node.type === "input" && node.props.type === "date").map(node => node.props.value), values);
    assert.equal(renderer.find(node => node.type === "button" && textOf(node) === "Save questions").props.disabled, false);
    assert.doesNotMatch(renderer.tree.map(textOf).join(" "), /Add a valid date range to every option/);
  } finally { renderer.unmount(); }
});
