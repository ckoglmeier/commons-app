import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { logisticsAddOptions } from "./logistics-add-menu";

test("one Add menu offers the same choices to organizers and travelers", () => {
  assert.deepEqual(logisticsAddOptions(true).map(option => option.label), ["Activity", "Meal", "Flight", "Transport", "Lodging"]);
  assert.deepEqual(logisticsAddOptions(false).map(option => option.label), ["Activity", "Meal", "Flight", "Transport", "Lodging"]);
});

test("trip saves always go to the trip's database; no demo copy is kept in the browser", async () => {
  const app = await readFile(new URL("./commons-app.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(app, /dataMode|previewBasics|sampleOnly|setSampleTravelPlans|appendPublicDemoStay|localStorage/);
  const travelSave = app.slice(app.indexOf("async function saveTravelPlan"), app.indexOf("async function saveFlightBooking"));
  assert.doesNotMatch(travelSave, /appendConversationMessage/);
  assert.match(travelSave, /\/travel-plans`/);
  const staySave = app.slice(app.indexOf("async function addStay"), app.indexOf("async function updateStay"));
  assert.match(staySave, /^async function addStay\(input: StayInput\) \{\n {4}const response = await fetch\(/);
});

test("the Add menu offers a cost from a receipt, not receipt storage", async () => {
  const menu = await readFile(new URL("./logistics-add-menu.tsx", import.meta.url), "utf8");
  assert.match(menu, /\{ label: "Cost from a receipt", action: addReceipt \}/);
  assert.doesNotMatch(menu, /label: "Receipts"/);
  const app = await readFile(new URL("./commons-app.tsx", import.meta.url), "utf8");
  assert.match(app, /Keeps the payer and amount without calculating who owes whom\./);
  assert.doesNotMatch(app, /"Not attached"|Keeps the payer and receipt/);
  assert.match(app, /\{expense\.receiptUrl \|\| expense\.receiptStatus === "attached" \? <div><dt>Receipt<\/dt>/);
});
