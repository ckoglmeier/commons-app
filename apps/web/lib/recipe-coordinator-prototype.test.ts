import assert from "node:assert/strict";
import test from "node:test";
import { demoReducer, initialDemo, restoreDemo, roundError, fixtureCompatible, type DemoState, type Action } from "../app/prototype/recipe-coordinator/demo-state";

const run = (state: DemoState, ...actions: Action[]) => actions.reduce(demoReducer, state);
const start = () => run(initialDemo(), { type: "restore" }, { type: "start-recipe" });
const completeFirstRound = () => run(start(), { type: "share" }, { type: "responses", count: 7 });
const secondRound = () => run(completeFirstRound(), { type: "follow-up" }, { type: "share" }, { type: "responses", count: 7 });

test("recipe prototype resumes one task and preserves each conversation's unsent text", () => {
  let state = run(initialDemo(), { type: "draft", text: "Main unsent" }, { type: "start-recipe" }, { type: "draft", text: "Recipe unsent" });
  const task = state.task;
  state = run(state, { type: "select", destination: "main" }, { type: "start-recipe" });
  assert.equal(state.task, task);
  assert.deepEqual(state.drafts, { main: "Main unsent", recipe: "Recipe unsent" });
  assert.equal(state.task?.rounds.length, 1);
});

test("quick poll stays in main and does not create or replace a recipe task", () => {
  let state = run(initialDemo(), { type: "quick-poll" });
  assert.equal(state.task, null);
  assert.equal(state.selected, "main");
  const quickId = state.quick?.id;
  state = run(state, { type: "start-recipe" });
  const task = state.task;
  state = run(state, { type: "quick-poll" });
  assert.equal(state.task, task);
  assert.equal(state.quick?.id, quickId);
  assert.equal(state.selected, "main");
});

test("only explicit sharing freezes questions; results cannot arrive before sharing", () => {
  const state = start();
  assert.equal(demoReducer(state, { type: "responses", count: 7 }), state);
  const shared = run(state, { type: "share" });
  const round = shared.task!.rounds[0];
  assert.equal(round.shared, true);
  assert.equal(demoReducer(shared, { type: "edit-round", round: { ...round, title: "Changed" } }), shared);
  assert.equal(shared.task?.decision, null);
  assert.equal(shared.task?.applied, false);
});

test("partial evidence cannot generate the confirmation round; follow-up does not copy votes", () => {
  const partial = run(start(), { type: "share" }, { type: "responses", count: 3 });
  assert.equal(demoReducer(partial, { type: "follow-up" }), partial);
  const full = run(partial, { type: "responses", count: 7 });
  const snapshot = structuredClone(full.task!.rounds[0]);
  const next = run(full, { type: "follow-up" });
  assert.deepEqual(next.task!.rounds[0], snapshot);
  assert.equal(next.task!.rounds[1].coverage, 0);
  assert.equal(next.task!.rounds[1].shared, false);
  assert.notEqual(next.task!.rounds[0].id, next.task!.rounds[1].id);
  assert.equal(demoReducer(next, { type: "follow-up" }), next, "does not duplicate round two");
});

test("decision requires fresh combination answers and a recorded accommodation; apply is separate", () => {
  const state = secondRound();
  const option = state.task!.rounds[1].questions[0].options[0];
  assert.equal(demoReducer(state, { type: "approve", option }), state);
  assert.equal(demoReducer(state, { type: "apply-trip" }), state);
  const ready = run(state, { type: "resolve-need", text: "Maya can arrive Friday evening." });
  assert.equal(demoReducer(ready, { type: "approve", option: "Unasked destination" }), ready);
  const approved = run(ready, { type: "approve", option });
  assert.equal(approved.task!.decision!.option, option);
  assert.equal(approved.task!.applied, false);
  const applied = run(approved, { type: "apply-trip" });
  assert.equal(applied.task!.applied, true);
  assert.match(applied.mainTurns.at(-1)!.text, /demo trip/);
  assert.equal(demoReducer(applied, { type: "apply-trip" }), applied, "repeat apply is a no-op");
});

test("unsupported chat text is explicitly bounded and cannot perform real actions", () => {
  const state = start();
  const next = run(state, { type: "send", text: "Book a hotel and send the group an SMS" });
  assert.match(next.task!.turns.at(-1)!.text, /No AI is connected/);
  assert.deepEqual(next.task!.rounds, state.task!.rounds);
  assert.equal(next.task!.applied, false);
  assert.equal(next.task!.decision, null);
});

test("local recovery retains rounds and drafts; reset clears only prototype state", () => {
  const state = run(secondRound(), { type: "draft", text: "Still thinking" });
  assert.deepEqual(restoreDemo(JSON.stringify(state)), state);
  assert.equal(restoreDemo("broken JSON"), undefined);
  assert.equal(restoreDemo(JSON.stringify({ ...state, version: 99 })), undefined);
  const reset = run(state, { type: "reset" });
  assert.equal(reset.task, null);
  assert.equal(reset.quick, null);
  assert.deepEqual(reset.drafts, { main: "", recipe: "" });
});

test("draft validation rejects missing or duplicate option content", () => {
  const round = start().task!.rounds[0];
  assert.equal(roundError(round), null);
  assert.notEqual(roundError({ ...round, title: " " }), null);
  assert.notEqual(roundError({ ...round, questions: [] }), null);
  assert.notEqual(roundError({ ...round, questions: [{ ...round.questions[0], options: ["Sonoma", " sonoma "] }] }), null);
});

test("edited options and dates-only asks cannot inherit synthetic evidence for a different question set", () => {
  const seeded = start();
  const round = seeded.task!.rounds[0];
  assert.equal(fixtureCompatible(round), true);
  const changedRound = { ...round, questions: round.questions.map((question, index) => index ? { ...question, options: ["Denver", "Santa Fe"] } : question) };
  assert.equal(fixtureCompatible(changedRound), false);
  const changed = run(seeded, { type: "edit-round", round: changedRound }, { type: "share" });
  assert.equal(demoReducer(changed, { type: "responses", count: 7 }), changed);
  const datesOnly = run(start(), { type: "send", text: "Ask dates only" }, { type: "share" });
  assert.equal(datesOnly.task!.rounds[0].questions.length, 1);
  assert.equal(demoReducer(datesOnly, { type: "responses", count: 7 }), datesOnly);
  assert.equal(demoReducer(datesOnly, { type: "follow-up" }), datesOnly);
});

test("fixture evidence is invalid after prompt-only inversion or changed participation instructions", () => {
  const state = start();
  const round = state.task!.rounds[0];
  for (const edited of [
    { ...round, questions: round.questions.map((question, index) => index === 0 ? { ...question, prompt: "Which dates cannot you do?" } : question) },
    { ...round, questions: round.questions.map((question, index) => index === 0 ? { ...question, required: false } : question) },
    { ...round, message: "Only answer for your own favorite person, not yourself." },
  ]) {
    assert.equal(fixtureCompatible(edited), false);
    const shared = run(state, { type: "edit-round", round: edited }, { type: "share" });
    assert.equal(demoReducer(shared, { type: "responses", count: 7 }), shared);
  }
});

test("recipe goal survives round changes and resumption without rewriting poll evidence", () => {
  const state = completeFirstRound();
  const rounds = structuredClone(state.task!.rounds);
  const edited = run(state, { type: "goal", text: "A strong date and location fit, without extra rounds" }, { type: "select", destination: "main" }, { type: "start-recipe" });
  assert.equal(edited.task!.goal, "A strong date and location fit, without extra rounds");
  assert.deepEqual(edited.task!.rounds, rounds);
  const followup = run(edited, { type: "follow-up" });
  assert.equal(followup.task!.goal, edited.task!.goal);
});

test("a weak-fit alternative cannot silently complete the strong-fit goal", () => {
  const state = run(secondRound(), { type: "resolve-need", text: "Maya joins Friday evening." });
  const weakFit = state.task!.rounds[1].questions[0].options[1];
  const attempted = run(state, { type: "approve", option: weakFit }, { type: "apply-trip" });
  assert.equal(attempted.task!.decision, null);
  assert.equal(attempted.task!.applied, false);
});

test("editing a goal cannot reuse sample evidence to approve or apply a different outcome", () => {
  const ready = run(secondRound(), { type: "resolve-need", text: "Maya joins Friday evening." });
  const option = ready.task!.rounds[1].questions[0].options[0];
  const changed = run(ready, { type: "goal", text: "Book and pay for everyone's hotel" }, { type: "approve", option }, { type: "apply-trip" });
  assert.equal(changed.task!.decision, null);
  assert.equal(changed.task!.applied, false);
  const approved = run(ready, { type: "approve", option });
  const amended = run(approved, { type: "goal", text: "" }, { type: "apply-trip" });
  assert.deepEqual(amended.task!.decision, approved.task!.decision);
  assert.equal(amended.task!.applied, false);
  assert.deepEqual(restoreDemo(JSON.stringify(amended))!.task!.rounds, ready.task!.rounds);
});
