import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, like } from "drizzle-orm";
import { commons, createCommonsPoll, expenses, messagingMessages, phoneHashOf, pollResponses, setEventAttendance } from "@commons/database";
import { sendGate } from "./provider";
import { InAppProvider, isTestNumber, testNumberFor } from "./in-app-provider";
import { actAs, json, skip, world } from "./test-world";

/*
 * The whole conversation through the in-app test thread, on a disposable database. Nothing here reaches a phone. It's synthetic evidence that the
 * conversation works, not evidence that a carrier will deliver it.
 */
const TESTER = "tester@example.test";
const thread = () => import("../../../app/api/v1/messaging/test-thread/route");
const contact = () => import("../../../app/api/v1/profile/contact/route");
const post = (body: unknown) => new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const read = async () => json(await (await thread()).GET());
const reply = async (body: string, id = randomUUID()) => json(await (await thread()).POST(post({ id, body })));
const check = async () => json(await (await thread()).POST(post({ check: true })));
const latest = (result: { body: Record<string, any> | null }) => result.body?.messages?.at(-1)?.body as string; // eslint-disable-line @typescript-eslint/no-explicit-any

/** World with the in-app provider, and Maya signed in as a listed tester. */
async function setup(options: { listed?: boolean } = {}) {
  const w = await world();
  process.env.COMMONS_SMS_PROVIDER = "in_app";
  process.env.COMMONS_SMS_IN_APP_ACCOUNTS = options.listed === false ? "someone-else@example.test" : TESTER;
  w.useProvider(new InAppProvider());
  (await import("./test-thread")).setViewerEmailForTests(TESTER);
  actAs(w.ids.maya);
  return w;
}
function restore() { delete process.env.COMMONS_SMS_PROVIDER; delete process.env.COMMONS_SMS_IN_APP_ACCOUNTS; }

test("test numbers are fictional, stable, and a real provider never spends a message on one", () => {
  const number = testNumberFor(randomUUID());
  assert.ok(isTestNumber(number), number);
  const id = randomUUID();
  assert.equal(testNumberFor(id), testNumberFor(id));
  assert.equal(isTestNumber("+14155551234"), false);
  const real = { synthetic: false, sendReadiness: () => ({ ready: true }) } as never;
  assert.equal(sendGate(real, number, { COMMONS_SMS_SEND_MODE: "live" }).allowed, false);
});

test("only listed accounts have a thread, and a real number can't be verified through it", { skip }, async () => {
  const w = await setup({ listed: false });
  try {
    assert.equal((await read()).status, 404);
    process.env.COMMONS_SMS_IN_APP_ACCOUNTS = TESTER;
    assert.equal((await read()).status, 200);
    const { POST } = await contact();
    const refused = await json(await POST(post({ kind: "phone", value: "+14155551234" })));
    assert.equal(refused.body?.code, "test_number_required");
    const someoneElses = await json(await POST(post({ kind: "phone", value: testNumberFor(w.ids.sam) })));
    assert.equal(someoneElses.body?.code, "test_number_required", "another tester's number, and its thread, can't be claimed");
  } finally { restore(); await w.cleanup(); }
});

test("the full loop: confirm a test number, turn on a trip, answer, ask, report money, and stop", { skip }, async () => {
  const w = await setup(); const phone = testNumberFor(w.ids.maya);
  try {
    const first = await read();
    assert.equal(first.body?.phone, null); assert.equal(first.body?.suggestedPhone, phone);

    // The code shows up in the thread, because a fictional number can't receive it anywhere else.
    const { POST, PUT } = await contact();
    const coded = await json(await POST(post({ kind: "phone", value: phone })));
    assert.equal(coded.status, 200, JSON.stringify(coded.body));
    // Read the way a tester reads it: through the screen's own request, before any number is confirmed.
    const pending = await read();
    assert.equal(pending.body?.phone, null);
    const code = /code is (\d{6})/.exec(latest(pending))?.[1] ?? "";
    assert.match(code, /^\d{6}$/);
    // Nobody else's screen shows it.
    actAs(w.ids.sam);
    assert.deepEqual((await read()).body?.messages, []);
    actAs(w.ids.maya);
    assert.equal((await PUT(new Request("http://localhost/x", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: phone, code }) }))).status, 200);
    assert.match(latest(await read()), /verification code/);

    // Consent is still per trip.
    assert.deepEqual((await read()).body?.trips.map((trip: { enrolled: boolean }) => trip.enrolled), [false]);
    const { POST: enroll } = await import("../../../app/api/v1/commons/[slug]/messaging/route");
    assert.equal((await enroll(post({ consent: true }), { params: Promise.resolve({ slug: w.slugs.sonoma }) })).status, 200);
    const welcomed = await read();
    assert.match(latest(welcomed), /this is Commons/); assert.match(latest(welcomed), /are you in/i);
    assert.deepEqual(welcomed.body?.trips.map((trip: { enrolled: boolean }) => trip.enrolled), [true]);

    // Attendance through the normal command.
    assert.match(latest(await reply("yes")), /You're in for Sonoma Weekend/);
    assert.equal(await w.attendance("maya", "sonoma"), "attending");

    // A published poll, asked and answered.
    const questionId = randomUUID(), saturday = randomUUID(), sunday = randomUUID();
    const poll = await createCommonsPoll(w.slugs.sonoma, { commandId: randomUUID(), title: "Dinner", ballotMode: "transparent", audience: { personIds: [w.ids.maya], guestEmails: [] }, questions: [{ id: questionId, kind: "choice", prompt: "Which night?", required: true, selectionMode: "single", options: [{ id: saturday, label: "Saturday", exclusive: false }, { id: sunday, label: "Sunday", exclusive: false }] }] }, { databaseUrl: w.url, actorPersonId: w.ids.casey });
    w.clock.advance(7 * 3_600_000);
    assert.match(latest(await check()), /Which night\?/);
    assert.match(latest(await reply("sunday please")), /recorded "Sunday"/);
    const [response] = await w.q(db => db.select().from(pollResponses).where(eq(pollResponses.pollId, poll.id)));
    assert.deepEqual(response!.answers[0]!.optionIds, [sunday]);

    // A plan question, and a stay.
    await w.addStay("sonoma", "Vineyard Cottage", "12 Grape Rd", [w.ids.maya]);
    assert.match(latest(await reply("what's the address?")), /12 Grape Rd/);

    // A cost, approved by code, sent twice.
    const summary = latest(await reply("I covered dinner, $120, me and Sam"));
    assert.match(summary, /Nothing is saved yet/);
    const approval = /SAVE ([A-Z0-9]{3})/.exec(summary)![1]!, id = randomUUID();
    assert.match(latest(await reply(`SAVE ${approval}`, id)), /I added Dinner/);
    await reply(`SAVE ${approval}`, id);
    assert.equal((await w.q(db => db.select().from(expenses).where(eq(expenses.commonsId, w.ids.sonoma)))).length, 1);

    // STOP is answered by Commons here, because no carrier is in the way, and everything stops.
    assert.match(latest(await reply("STOP")), /you're unsubscribed/);
    const after = await reply("what's the address?");
    assert.match(after.body?.messages.at(-1).body, /what's the address/, "the message is recorded, and nothing answers it");
    assert.equal(after.body?.messages.at(-1).from, "you");
  } finally {
    restore();
    await w.q(db => db.delete(messagingMessages).where(eq(messagingMessages.phoneHash, phoneHashOf(phone))));
    await w.cleanup();
  }
});

test("quiet hours hold in the thread too, and it says the message is waiting rather than sent", { skip }, async () => {
  const w = await setup(); const phone = testNumberFor(w.ids.maya);
  try {
    const { POST, PUT } = await contact();
    await POST(post({ kind: "phone", value: phone }));
    const code = /code is (\d{6})/.exec(latest(await read()))?.[1] ?? "";
    await PUT(new Request("http://localhost/x", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: phone, code }) }));
    const { POST: enroll } = await import("../../../app/api/v1/commons/[slug]/messaging/route");
    w.clock.set("2026-11-05T10:00:00Z"); // 2am in the trip's time zone
    await enroll(post({ consent: true }), { params: Promise.resolve({ slug: w.slugs.sonoma }) });
    const waiting = (await read()).body?.messages.at(-1);
    assert.equal(waiting.status, "queued"); assert.equal(waiting.detail, "quiet_hours"); assert.ok(waiting.waitingUntil);
    await setEventAttendance(w.slugs.sonoma, { commandId: randomUUID(), state: "attending", reviewedDates: "2027-06-11/2027-06-13" }, { databaseUrl: w.url, actorPersonId: w.ids.maya });
  } finally {
    restore();
    await w.q(db => db.delete(messagingMessages).where(eq(messagingMessages.phoneHash, phoneHashOf(phone))));
    await w.cleanup();
  }
});

test("one tap starts a test trip with texts on, and it answers every piece", { skip }, async () => {
  const w = await setup(); const phone = testNumberFor(w.ids.maya);
  try {
    assert.equal((await json(await (await thread()).POST(post({ testTrip: true })))).status, 404, "a confirmed number comes first");
    const { POST, PUT } = await contact();
    await POST(post({ kind: "phone", value: phone }));
    const code = /code is (\d{6})/.exec(latest(await read()))?.[1] ?? "";
    await PUT(new Request("http://localhost/x", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: phone, code }) }));

    const started = await json(await (await thread()).POST(post({ testTrip: true })));
    assert.equal(started.status, 200, JSON.stringify(started.body));
    assert.match(latest(started), /Text test trip/); assert.match(latest(started), /are you in/i);
    assert.match(latest(await reply("yes")), /You're in for Text test trip/);
    assert.match(latest(await check()), /What should we eat on the last night\?/);
    assert.match(latest(await reply("Pizza")), /recorded "Pizza"/);
    assert.match(latest(await reply("what's the address for dinner")), /123 Example St/);
    assert.match(latest(await reply("what's next")), /Morning hike/);
    assert.match(latest(await reply("I covered dinner, $120, me and Sam")), /Sam/);

    // A second test trip takes over the thread: the first one's texts are off, and nothing was sent to Sam, who has no number or account.
    const again = await json(await (await thread()).POST(post({ testTrip: true })));
    const enrolled = (again.body?.trips as Array<{ name: string; enrolled: boolean }>).filter(trip => trip.name === "Text test trip");
    assert.deepEqual(enrolled.map(trip => trip.enrolled).sort(), [false, true]);
  } finally {
    restore();
    await w.q(async db => {
      await db.delete(messagingMessages).where(eq(messagingMessages.phoneHash, phoneHashOf(phone)));
      await db.delete(commons).where(like(commons.slug, "text-test-trip-%"));
    });
    await w.cleanup();
  }
});

test("someone with no number can't post into the thread, and an inbound webhook can't reach it", { skip }, async () => {
  const w = await setup();
  try {
    assert.equal((await reply("hello")).status, 404);
    const { POST } = await import("../../../app/api/v1/messaging/inbound/route");
    assert.equal((await POST(new Request("http://localhost/api/v1/messaging/inbound", { method: "POST", body: "{}" }))).status, 401);
  } finally { restore(); await w.cleanup(); }
});
