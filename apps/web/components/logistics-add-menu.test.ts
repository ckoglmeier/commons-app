import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { logisticsAddOptions } from "./logistics-add-menu";

test("one Add menu offers stays only to an authorized organizer or sample reviewer", () => {
  assert.deepEqual(logisticsAddOptions(true).map(option => option.label), ["Activity", "Meal", "Flight", "Transport", "Lodging"]);
  assert.deepEqual(logisticsAddOptions(false).map(option => option.label), ["Activity", "Meal", "Flight", "Transport", "Lodging"]);
});

test("header Add supports keyboard/dismissal and replaces per-person and stay Add buttons", async () => {
  const menu = await readFile(new URL("./logistics-add-menu.tsx", import.meta.url), "utf8");
  const board = await readFile(new URL("./event-logistics-view.tsx", import.meta.url), "utf8");
  const person = await readFile(new URL("./person-travel.tsx", import.meta.url), "utf8");
  const app = await readFile(new URL("./commons-app.tsx", import.meta.url), "utf8");
  assert.match(menu, /aria-haspopup="menu" aria-expanded=\{open\}/);
  assert.match(menu, /ArrowDown.*ArrowUp.*Home.*End/);
  assert.match(menu, /Escape/);
  assert.match(menu, /pointerdown/);
  assert.match(menu, /onBlur/);
  assert.match(menu, /role="menuitem"[^>]*tabIndex=\{-1\}/);
  assert.match(menu, /aria-label=\{option.label\}/);
  assert.match(board, /event-logistics-intro.*<LogisticsAddMenu/);
  assert.doesNotMatch(board, />Add stay<|event-logistics-add/);
  assert.doesNotMatch(person, />Add travel<|>Add rental car</);
  assert.match(app, /currentActorId=\{initialSnapshot.currentActor.id\}/);
  assert.match(app, /setSelectedTravelPlanId\(kind === "transport" \? "" : null\)/);
});

test("sample logistics saves use memory overlays, not shared messages or persistent demo storage", async () => {
  const app = await readFile(new URL("./commons-app.tsx", import.meta.url), "utf8");
  assert.match(app, /JSON.stringify\(savedState\)/);
  assert.doesNotMatch(app, /JSON.stringify\(state\)/);
  const travelSave = app.slice(app.indexOf("async function saveTravelPlan"), app.indexOf("async function saveFlightBooking"));
  assert.doesNotMatch(travelSave, /appendConversationMessage/);
  assert.match(travelSave, /visibility: existing\?\.visibility \?\?/);
  assert.match(travelSave, /setSampleTravelPlans/);
  const staySave = app.slice(app.indexOf("async function addStay"), app.indexOf("async function updateStay"));
  assert.match(staySave, /if \(!previewBasics\) throw/);
  assert.ok(staySave.indexOf("return;") < staySave.indexOf("await fetch"));
  assert.match(staySave, /appendPublicDemoStay/);
});
