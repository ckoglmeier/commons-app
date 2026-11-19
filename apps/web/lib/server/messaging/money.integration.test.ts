import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { commons, expenses, expenseShares, paymentReports, reimbursements, setEventAttendance } from "@commons/database";
import { loadRoutes, skip, world } from "./test-world";

/* Synthetic evidence: real routes and the real Money commands on a disposable database, with the fake provider. No message leaves the process. */
async function setup(trips: Array<"sonoma" | "tahoe"> = ["sonoma"]) {
  const w = await world({ trips }), routes = await loadRoutes();
  await w.enroll(routes, "maya", "sonoma");
  await setEventAttendance(w.slugs.sonoma, { commandId: randomUUID(), state: "attending", reviewedDates: "2027-06-11/2027-06-13" }, { databaseUrl: w.url, actorPersonId: w.ids.maya });
  await w.text(routes, w.phones.maya, "ok"); // clears the settled attendance question
  const say = (body: string) => w.text(routes, w.phones.maya, body);
  const tripExpenses = () => w.q(db => db.select().from(expenses).where(eq(expenses.commonsId, w.ids.sonoma)));
  const code = () => /SAVE ([A-Z0-9]{3})/.exec(w.last())?.[1] ?? "";
  return { w, routes, say, tripExpenses, code };
}

test("an expense: nothing is saved until the exact summary is approved, then the normal command saves it once", { skip }, async () => {
  const { w, say, tripExpenses, code } = await setup();
  try {
    await say("I covered dinner, $120, me and Sam");
    assert.match(w.last(), /Nothing is saved yet/); assert.match(w.last(), /Dinner, \$120\.00/); assert.match(w.last(), /Paid by you/); assert.match(w.last(), /Maya, Sam/); assert.match(w.last(), /\$60\.00 each/);
    assert.match(w.last(), /today, since you didn't say/);
    assert.equal((await tripExpenses()).length, 0);
    const approval = code();

    await say("yes");
    assert.match(w.last(), /waiting on your answer about the summary/); assert.equal((await tripExpenses()).length, 0, "a bare yes approves nothing");
    await say("SAVE ZZZ");
    assert.equal((await tripExpenses()).length, 0, "a wrong code saves nothing");
    const id = `IN-money-${randomUUID().slice(0, 8)}`;
    const routes = await loadRoutes();
    await w.text(routes, w.phones.maya, `SAVE ${approval}`, { id });
    await w.text(routes, w.phones.maya, `SAVE ${approval}`, { id }); // the provider redelivers
    await say(`SAVE ${approval}`); // and the person sends it twice
    const saved = await tripExpenses();
    assert.equal(saved.length, 1);
    assert.equal(saved[0]!.title, "Dinner"); assert.equal(saved[0]!.amountCents, 12000); assert.equal(saved[0]!.paidByPersonId, w.ids.maya);
    const shares = await w.q(db => db.select().from(expenseShares).where(eq(expenseShares.expenseId, saved[0]!.id)));
    assert.deepEqual(shares.map(share => share.amountCents).sort(), [6000, 6000]);
    assert.deepEqual(shares.map(share => share.personId).sort(), [w.ids.maya, w.ids.sam].sort(), "only the people named, never the whole trip");
  } finally { await w.cleanup(); }
});

test("who it's for: unstated offers the whole group by name, an unknown or doubtful name is asked about", { skip }, async () => {
  const { w, say, tripExpenses, code } = await setup();
  try {
    await say("I bought groceries $90");
    const named = /Split equally: ([^(]+) \(/.exec(w.last())?.[1]?.split(", ").sort();
    assert.deepEqual(named, ["Casey", "Maya", "Sam"], "the whole group is offered by name, for confirmation"); assert.match(w.last(), /\$30\.00 each/);
    await say("I bought groceries $90 with Jordan");
    assert.match(w.last(), /I don't see Jordan on this trip/); assert.match(w.last(), /Nothing is saved yet/);
    await say("Sam");
    assert.match(w.last(), /Groceries, \$90\.00/); assert.match(w.last(), /Split equally: Sam/);
    await say(`SAVE ${code()}`);
    const [saved] = await tripExpenses();
    const shares = await w.q(db => db.select().from(expenseShares).where(eq(expenseShares.expenseId, saved!.id)));
    assert.deepEqual(shares.map(share => share.personId), [w.ids.sam], "the reply names who it's for");
  } finally { await w.cleanup(); }
});

test("missing facts are asked for one at a time, and DISCARD drops it", { skip }, async () => {
  const { w, say, tripExpenses, code } = await setup();
  try {
    await say("I covered dinner");
    assert.match(w.last(), /What was the total\?/);
    await say("a lot");
    assert.match(w.last(), /Reply with the amount/);
    await say("85.50");
    assert.match(w.last(), /Dinner, \$85\.50/);
    await say("DISCARD");
    assert.match(w.last(), /Nothing was saved/);
    assert.equal((await tripExpenses()).length, 0);

    await say("paid $40");
    assert.match(w.last(), /What was it for\?/);
    await say("parking");
    assert.match(w.last(), /Parking, \$40\.00/);
    assert.match(code(), /^[A-Z0-9]{3}$/);
  } finally { await w.cleanup(); }
});

test("a correction replaces the pending summary, and the old code stops working", { skip }, async () => {
  const { w, say, tripExpenses, code } = await setup();
  try {
    await say("paid $40 for gas");
    const old = code();
    await say("paid $45 for gas");
    assert.match(w.last(), /Gas, \$45\.00/);
    const current = code();
    if (old !== current) { await say(`SAVE ${old}`); assert.equal((await tripExpenses()).length, 0, "the old version can't be approved"); }
    await say(`SAVE ${current}`);
    const saved = await tripExpenses();
    assert.equal(saved.length, 1); assert.equal(saved[0]!.amountCents, 4500);
  } finally { await w.cleanup(); }
});

test("a foreign receipt keeps its currency, an unstated one says it's the trip's, and a likely duplicate says so", { skip }, async () => {
  const { w, say, tripExpenses, code } = await setup();
  try {
    await say("paid €18 for taxi");
    assert.match(w.last(), /Taxi, €18\.00/); assert.doesNotMatch(w.last(), /trip's currency/);
    await say(`SAVE ${code()}`);
    assert.equal((await tripExpenses())[0]!.currency, "EUR");
    await say("paid 20 dollars for lunch");
    assert.doesNotMatch(w.last(), /trip's currency/);
    await say("I covered snacks");
    await say("12");
    assert.match(w.last(), /USD, the trip's currency/);
    await say("DISCARD");
    await say("paid €18 for taxi");
    assert.match(w.last(), /looks like one already saved/);
  } finally { await w.cleanup(); }
});

test("a payment report changes no balance and records no reimbursement", { skip }, async () => {
  const { w, say, code } = await setup();
  try {
    await say("I paid Sam $40");
    assert.match(w.last(), /you paid Sam \$40\.00/); assert.match(w.last(), /doesn't move money/);
    await say(`SAVE ${code()}`);
    assert.match(w.last(), /Balances haven't changed/);
    const reports = await w.q(db => db.select().from(paymentReports).where(eq(paymentReports.commonsId, w.ids.sonoma)));
    assert.equal(reports.length, 1); assert.equal(reports[0]!.toPersonId, w.ids.sam); assert.equal(reports[0]!.amountCents, 4000);
    assert.equal((await w.q(db => db.select().from(reimbursements).where(eq(reimbursements.commonsId, w.ids.sonoma)))).length, 0);

    await say("I paid attention");
    assert.doesNotMatch(w.last(), /Who did you pay/, "ordinary chat isn't a report");
    await say("I paid Jordan $5");
    assert.match(w.last(), /I don't see Jordan/);
    await say("Sam");
    assert.match(w.last(), /you paid Sam \$5\.00/);
  } finally { await w.cleanup(); }
});

test("someone else paying is sent to Money, a closed ledger saves nothing, and the sender can't speak for another payer", { skip }, async () => {
  const { w, say, tripExpenses, code } = await setup();
  try {
    await say("Sam paid for dinner $120");
    assert.match(w.last(), /only add what you paid yourself/); assert.equal((await tripExpenses()).length, 0);

    await say("paid $10 for ice");
    const approval = code();
    await w.q(db => db.update(commons).set({ expensesClosedAt: new Date() }).where(eq(commons.id, w.ids.sonoma)));
    await say(`SAVE ${approval}`);
    assert.match(w.last(), /couldn't save that, so nothing changed/); assert.equal((await tripExpenses()).length, 0);
  } finally { await w.cleanup(); }
});

test("a money question doesn't swallow other messages, and DISCARD goes to what was just asked", { skip }, async () => {
  const { w, say, tripExpenses, code } = await setup();
  try {
    await say("I covered dinner");
    assert.match(w.last(), /What was the total|How much/);
    await say("dinner at 7");
    assert.match(w.last(), /Reply with the amount/, "dinner at 7 isn't $7");
    await say("when does it start");
    assert.match(w.last(), /from the saved plan/, "a plan question is answered");
    await say("120");
    assert.match(w.last(), /Dinner, \$120\.00/, "and the money question was still waiting");

    // A second report says it replaced the first, rather than dropping it silently.
    const first = code();
    await say("paid $20 for parking");
    assert.match(w.last(), /This replaces the one you hadn't saved/);
    if (first !== code()) { await say(`SAVE ${first}`); assert.equal((await tripExpenses()).length, 0); }

    // With a summary pending, DISCARD after a question about a different report goes to that question.
    await say("I covered snacks");
    assert.match(w.last(), /total|How much/i);
    await say("DISCARD");
    assert.match(w.last(), /Nothing was saved/);
    assert.equal((await tripExpenses()).length, 0);
  } finally { await w.cleanup(); }
});

test("a name that couldn't be read safely is asked about, not split across the whole trip", { skip }, async () => {
  const { w, say } = await setup();
  try {
    await say("paid $120 for dinner with Sam at the Lodge");
    assert.match(w.last(), /Who was it for\?/);
    await say("me and Sam");
    assert.match(w.last(), /Split equally: Maya, Sam/);
  } finally { await w.cleanup(); }
});

test("two trips: a report waits until the person says which trip", { skip }, async () => {
  const w = await world({ trips: ["sonoma", "tahoe"] });
  try {
    const routes = await loadRoutes();
    await w.enroll(routes, "maya", "sonoma"); await w.enroll(routes, "maya", "tahoe");
    await w.text(routes, w.phones.maya, "paid $25 for gas");
    assert.match(w.last(), /Which trip is this for\?/);
    await w.text(routes, w.phones.maya, "2");
    assert.match(w.last(), /Gas, \$25\.00/); assert.match(w.last(), /Tahoe/);
    assert.equal((await w.q(db => db.select().from(expenses).where(eq(expenses.commonsId, w.ids.sonoma)))).length, 0);
  } finally { await w.cleanup(); }
});
