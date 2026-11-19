import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { buildFoodPollData, type FoodRunDetail } from "@commons/contracts";
import { createHookRenderer, registerComponentImportStubs, textOf } from "@/lib/test-support/hook-harness";
import { installFakeLiveEnvironment, settle } from "@/lib/test-support/fake-live-transport";
registerComponentImportStubs();
const food = (published = false): FoodRunDetail => {
  const data = buildFoodPollData({});
  return { id: crypto.randomUUID(), recipe: "food_preferences", title: data.title, stage: published ? "decide" : "draft", draft: { id: crypto.randomUUID(), version: 2, published, archived: false }, participantPreview: data, poll: published ? { id: crypto.randomUUID(), publicId: "abc123abc123", status: "closed", responseCount: 1, superseded: false, audienceKind: "link", ballotMode: "transparent" } : null, summary: published ? { responseCount: 1, entries: [{ responseId: crypto.randomUUID(), name: "Synthetic", requirements: "Fresh saved answer", preferences: null, notes: null }] } : null, history: [], notes: [], outcome: null } as unknown as FoodRunDetail;
};

test("food uses three accessible accordions, preserves edits across stages, and saves editable questions", async () => {
  const { FoodRecipe } = await import("./recipe-food"), { GoalStages } = await import("./goal-stages"), { PublishPanel } = await import("./recipe-shared");
  const renderer = createHookRenderer({ expand: [FoodRecipe, GoalStages] });
  const current = food(), requests: Array<{ path: string; body: unknown }> = [];
  const props = { run: current, slug: "qa", busy: false, runBase: "/run", act: async (work: () => Promise<unknown>) => { await work(); }, call: async <T,>(path: string, _method: string, body?: unknown) => { requests.push({ path, body }); return { ok: true as const, data: {} as T }; } };
  try {
    renderer.render(createElement(FoodRecipe, props));
    const button = (name: string) => renderer.find(n => n.type === "button" && (n.props["aria-label"] === name || textOf(n) === name));
    assert.equal(button("Build").props["aria-expanded"], true);
    assert.equal(button("Share").props["aria-expanded"], false);
    const prompt = current.participantPreview!.questions[0].prompt;
    (renderer.find(n => n.type === "input" && n.props.value === prompt).props.onChange as (event: unknown) => void)({ target: { value: "Updated question" } }); renderer.flush();
    (button("Share").props.onClick as () => void)(); renderer.flush();
    assert.equal(renderer.find(n => n.type === PublishPanel).props.ready, false, "Unsaved questions cannot be published");
    (button("Build").props.onClick as () => void)(); renderer.flush();
    assert.equal(renderer.find(n => n.type === "input" && n.props.value === "Updated question").props.value, "Updated question");
    (button("Add a question").props.onClick as () => void)(); renderer.flush();
    assert.equal(renderer.findAll(n => n.type === "fieldset").length, 4);
    const added = renderer.find(n => n.type === "input" && n.props.value === "");
    (added.props.onChange as (e: unknown) => void)({ target: { value: "Anything else?" } }); renderer.flush();
    (button("Save poll").props.onClick as () => void)(); await settle(2);
    const saved = requests[0].body as { questions: Array<{ prompt: string }>; expectedDraftVersion: number };
    assert.equal(saved.expectedDraftVersion, 2); assert.equal(saved.questions.length, 4); assert.equal(saved.questions[0].prompt, "Updated question");
    assert.equal(requests.length, 1, "Opening stages never writes or publishes");
  } finally { renderer.unmount(); }
});

test("closed food polls keep a copy link, show live answers rather than frozen outcomes and require no recording", async () => {
  const { FoodRecipe } = await import("./recipe-food"), { GoalStages } = await import("./goal-stages"), { PollShareLink } = await import("./recipe-shared");
  const live = installFakeLiveEnvironment({ liveFetch: async () => Response.json({}) }), current = food(true);
  Object.assign(window.location, { origin: "http://localhost" });
  let copied = ""; Object.assign(navigator, { clipboard: { writeText: async (value: string) => { copied = value; } } });
  const renderer = createHookRenderer({ expand: [FoodRecipe, GoalStages, PollShareLink] });
  try {
    renderer.render(createElement(FoodRecipe, { slug: "qa", run: current, busy: false, runBase: "/run", act: async () => { throw new Error("No write expected"); }, call: async () => { throw new Error("No write expected"); } }));
    const content = renderer.tree.map(textOf).join(" ");
    assert.match(content, /Fresh saved answer/); assert.doesNotMatch(content, /Record for meal planning|This outcome meets|Now|Next/);
    assert.equal(renderer.find(n => n.type === "button" && n.props["aria-label"] === "Decide").props["aria-expanded"], true);
    (renderer.find(n => n.type === "button" && n.props["aria-label"] === "Share").props.onClick as () => void)(); renderer.flush();
    const status = renderer.find(n => n.props.role === "status"); assert.equal(textOf(status), "");
    await (renderer.find(n => n.type === "button" && textOf(n) === "Copy poll link").props.onClick as () => Promise<void>)(); renderer.flush();
    assert.equal(copied, "http://localhost/c/poll/abc123abc123"); assert.equal(textOf(renderer.find(n => n.props.role === "status")), "Copied");
  } finally { renderer.unmount(); live.restore(); }
});

test("food revision shows earlier reported needs without pretending they are new responses", async () => {
  const { FoodRecipe } = await import("./recipe-food"), { GoalStages } = await import("./goal-stages");
  const run = food(), pollId = crypto.randomUUID(), at = new Date().toISOString();
  run.earlierFoodAnswers = [{ id: `food:${pollId}`, version: "v1", provenance: { kind: "poll_preference", recordType: "poll", recordId: pollId, threadId: null, label: "Earlier food input" }, freshness: { asOf: at, updatedAt: at }, value: { runId: run.id, pollId, title: "Earlier poll", status: "closed", roundState: "earlier", replacementState: "private_draft", historyIncomplete: false, responseCount: 1, omittedResponses: 0, entries: [{ responseId: crypto.randomUUID(), name: "Synthetic guest", requirements: "Peanut allergy", preferences: null, notes: null, truncated: false }] } }];
  const renderer = createHookRenderer({ expand: [FoodRecipe, GoalStages] });
  try {
    renderer.render(createElement(FoodRecipe, { run, slug: "qa", busy: false, runBase: "/run", act: async () => { throw new Error("No write expected"); }, call: async () => { throw new Error("No write expected"); } }));
    (renderer.find(n => n.type === "button" && n.props["aria-label"] === "Decide").props.onClick as () => void)(); renderer.flush();
    const body = textOf(renderer.find(n => n.props.className === "goal-stage__body" && n.props.hidden === false));
    assert.match(body, /Earlier answers · not reconfirmed/); assert.match(body, /Peanut allergy/); assert.match(body, /No answers in this new round/);
    assert.doesNotMatch(body, /no restrictions|1 response\. Saved for meal planning/i);
    assert.equal(run.summary, null);
    run.earlierFoodAnswers![0].value.responseCount = 0; run.earlierFoodAnswers![0].value.entries = []; run.earlierFoodAnswers![0].value.historyIncomplete = true;
    renderer.render(createElement(FoodRecipe, { run, slug: "qa", busy: false, runBase: "/run", act: async () => { throw new Error("No write expected"); }, call: async () => { throw new Error("No write expected"); } })); renderer.flush();
    assert.match(textOf(renderer.find(n => n.props.className === "goal-stage__body" && n.props.hidden === false)), /Additional earlier rounds are outside this view/);
  } finally { renderer.unmount(); }
});
