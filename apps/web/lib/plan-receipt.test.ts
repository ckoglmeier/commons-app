import assert from "node:assert/strict";
import test from "node:test";
import { activityReceipt, addedRecord, sameText, stableCommandId, stayReceipt, travelReceipt } from "./plan-receipt";

const item = (fields: Record<string, unknown>) => ({ id: "a1", title: "Kayaking", status: "idea", ...fields }) as never;

test("an undated activity points at No day yet, not a day or a booking", () => {
  const receipt = activityReceipt("trip", item({}), "America/Los_Angeles");
  assert.equal(receipt.status, "No day yet");
  assert.equal(receipt.section, "ideas");
  assert.equal(receipt.day, null);
  const url = new URL(receipt.href, "https://commons.test");
  assert.equal(url.searchParams.get("section"), "ideas");
  assert.equal(url.searchParams.get("itemId"), "a1");
});

test("a scheduled activity names its local day; only confirmed says confirmed", () => {
  const scheduled = activityReceipt("trip", item({ status: "planned", startsAt: "2027-05-15T02:00:00Z" }), "America/Los_Angeles");
  assert.equal(scheduled.day, "2027-05-14");
  assert.match(scheduled.status, /^Scheduled · Fri, May 14$/);
  assert.equal(scheduled.section, "schedule");
  assert.match(activityReceipt("trip", item({ status: "confirmed", scheduledDate: "2027-05-15" }), "UTC").status, /^Confirmed/);
});

test("stays and transport land in Travel & stays with their recorded state", () => {
  assert.equal(stayReceipt("trip", { id: "s1", name: "Harbor house", status: "considering" } as never).status, "Option we’re considering");
  assert.equal(new URL(stayReceipt("trip", { id: "s1", name: "H", status: "planned" } as never).href, "https://c.test").searchParams.get("item"), "stay");
  const transport = travelReceipt("trip", { id: "t1", kind: "transport", route: "Ferry", status: "considering", date: "2027-05-15" } as never);
  assert.equal(transport.section, "travel");
  assert.equal(transport.status, "Considering");
});

test("addedRecord names only the one new record matching what was submitted", () => {
  const records = [{ id: "a", title: "Hike" }, { id: "b", title: "Dinner" }, { id: "c", title: "Hike" }];
  assert.equal(addedRecord(new Set(["a"]), records, record => sameText(record.title, " dinner "))?.id, "b", "another person's concurrent add is not mistaken for ours");
  assert.equal(addedRecord(new Set(), records, record => sameText(record.title, "Hike")), null, "two matches give no receipt");
  assert.equal(addedRecord(new Set(["a", "b", "c"]), records, () => true), null);
});

test("a retry with unchanged input reuses its command ID; changed input does not", () => {
  const store = new Map();
  let n = 0;
  const create = () => `id-${++n}`;
  assert.equal(stableCommandId(store, "add-stay", { name: "A" }, create), "id-1");
  assert.equal(stableCommandId(store, "add-stay", { name: "A" }, create), "id-1");
  assert.equal(stableCommandId(store, "add-stay", { name: "B" }, create), "id-2");
  assert.equal(stableCommandId(store, "add-plan", { name: "B" }, create), "id-3");
});
