import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("receipt quick action opens the existing Money receipt editor",async()=>{
  const home=await readFile(new URL("./home-dashboard.tsx",import.meta.url),"utf8");
  assert.match(home,/Add receipts/);assert.match(home,/addReceipt/);assert.doesNotMatch(home,/Get help adding receipts/);
});
test("attendance remains contextual with explicit decline and reviewed dates", async () => {
  const source = await readFile(new URL("./event-attendance.tsx", import.meta.url), "utf8");
  assert.match(source, /context === "conversation" && \(!needsResponse \|\| saved\)/);
  assert.match(source, /currentState === "helping" \|\| currentState === "needs_confirmation"/);
  assert.match(source, /Change response/);
  assert.match(source, /reviewedDates: data.dates/);
  assert.match(source, /You’ll lose access to this trip/);
  assert.match(source, /Decline and leave trip/);
});
