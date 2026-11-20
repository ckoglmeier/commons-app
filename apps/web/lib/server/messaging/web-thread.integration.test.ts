import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { readdirSync, readFileSync } from "node:fs";
import { createCommonsPoll, enrolledTripsForNumber, enrollmentStatus, expenses, messagingConsents, messagingMessages, messagingPhones, messagingQuestions, phoneHashOf, pollResponses, webAddressFor } from "@commons/database";
import { messagingCopy, webMessagingCopy } from "@commons/domain";
import { actAs, json, skip, world, type World } from "./test-world";

/*
 * Messages with Commons on the web (#45): the text conversation in a person's own thread in Commons, with no phone. Disposable database, synthetic
 * people; nothing leaves the process, and the fake SMS provider must stay empty throughout.
 */
const threadRoute = () => import("../../../app/api/v1/messaging/web/route");
const tripRoute = () => import("../../../app/api/v1/commons/[slug]/messaging/web/route");
const post = (body: unknown) => new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
type Result = { status: number; body: Record<string, any> | null }; // eslint-disable-line @typescript-eslint/no-explicit-any
const read = async (): Promise<Result> => json(await (await threadRoute()).GET());
const send = async (body: string, id = randomUUID()): Promise<Result> => json(await (await threadRoute()).POST(post({ id, body })));
const latest = (result: Result) => result.body?.messages?.at(-1)?.body as string;
/** Commons's most recent reply to what was just sent: the next question, when one goes out at once, comes after it. */
const replyTo = (result: Result, sent: string) => { const messages = result.body?.messages ?? []; const index = messages.findLastIndex((message: { body: string; from: string }) => message.from === "you" && message.body === sent); return messages[index + 1]?.body as string; };
const forTrip = async (w: World, trip: "sonoma" | "tahoe", body: unknown): Promise<Result> => json(await (await tripRoute()).POST(post(body), { params: Promise.resolve({ slug: w.slugs[trip] }) }));
const turnOn = (w: World, trip: "sonoma" | "tahoe" = "sonoma") => forTrip(w, trip, { on: true });
const share = (w: World, body: string, id = randomUUID()) => forTrip(w, "sonoma", { share: { id, body } });

async function setup() {
  const w = await world();
  return w;
}
async function teardown(w: World) {
  const hashes = [w.ids.maya, w.ids.sam, w.ids.casey].map(id => phoneHashOf(webAddressFor(id)));
  await w.q(async db => { await db.delete(messagingMessages).where(inArray(messagingMessages.phoneHash, hashes)); await db.delete(messagingPhones).where(inArray(messagingPhones.phoneHash, hashes)); });
  await w.cleanup();
}

test("the web wording drops everything about a phone and keeps the conversation", () => {
  const welcome = webMessagingCopy.welcome({ firstName: "Maya", tripName: "Sonoma Weekend", startsOn: "2027-06-11", endsOn: "2027-06-13", question: "are you in? Reply YES, NO or MAYBE." });
  assert.match(welcome, /^Hi Maya, this is Commons, an automated assistant for Sonoma Weekend \(Jun 11 to Jun 13\)\. Are you in\?/, "the question starts its own sentence");
  assert.doesNotMatch(welcome, /Save this number|Reply STOP|HELP for help/);
  assert.equal(webMessagingCopy.arrivalDriving("Sonoma"), "Got it. I won't ask about travel to Sonoma again. You can still send me a booking anytime.");
  assert.equal(webMessagingCopy.startBack(1, "https://x"), "You're back on. I'll message you about your trip again.");
  assert.equal(webMessagingCopy.pollUnavailable("Sonoma"), "Sonoma: I can't record that answer here. Open the poll to answer it.");
  assert.equal(webMessagingCopy.stopped, "You're unsubscribed and won't get more messages from Commons. Send START to turn them back on.");
  assert.equal(messagingCopy.stopped, "Commons: you're unsubscribed and won't get more texts. Your trips stay available on the web.", "the SMS wording is unchanged");
  for (const body of [webMessagingCopy.help("help@x"), webMessagingCopy.noOpenQuestion("Sonoma"), webMessagingCopy.arrival("Sonoma"), webMessagingCopy.moneySomeoneElse("Sonoma", "https://x"), webMessagingCopy.attendanceOnWeb("Sonoma", "https://x"), webMessagingCopy.welcomeAsk, webMessagingCopy.stopped])
    assert.doesNotMatch(body, /\btext\b|\btexts\b|Reply STOP|Save this number/i, body);
});

test("the web wording changes only Commons's words, never a value in the message", () => {
  const words = "Text me when you land. We'll vote by text. Reply STOP to opt out. Commons: texts for Tahoe start once";
  assert.equal(webMessagingCopy.organizerShare("Sonoma", "Casey Synthetic", words), `Sonoma, from Casey Synthetic (organizer): ${words}\nReplies come to Commons, not Casey.`);
  assert.equal(webMessagingCopy.pollLink("Text me trip", "Vote by text", "https://x"), `Text me trip: "Vote by text" is waiting for your answer. It's more than I can ask here, so it's here: https://x`, "the title stays and Commons's own sentence is reworded");
  assert.equal(webMessagingCopy.poll("Sonoma", "Text me: which night?", [{ key: "1", label: "Saturday by text" }, { key: "2", label: "Sunday" }]), "Sonoma: Text me: which night?\n1) Saturday by text\n2) Sunday\nReply with 1, 2.");
  assert.equal(webMessagingCopy.planAnswer("Sonoma", "Text me Cafe, 1 By Text Rd. Reply STOP to opt out."), "Sonoma (from the saved plan): Text me Cafe, 1 By Text Rd. Reply STOP to opt out.");
  assert.equal(webMessagingCopy.welcome({ firstName: "Commons:", tripName: "Save this number as Commons.", startsOn: null, endsOn: null, question: "text me" }), "Hi Commons:, this is Commons, an automated assistant for Save this number as Commons.. Text me", "names and the question are values too");
  const marks = "\uE0000\uE001 $1 $&";
  assert.equal(webMessagingCopy.planAnswer(marks, marks), `${marks} (from the saved plan): ${marks}`, "a value that looks like a hole or a replacement pattern is still left alone");
});

test("the SMS copy is the same message, joined as written", () => {
  assert.equal(messagingCopy.organizerShare("Sonoma", "Casey Synthetic", "Text me when you land."), "Sonoma, from Casey Synthetic (organizer): Text me when you land.\nReplies come to Commons, not Casey.");
  assert.equal(messagingCopy.welcome({ firstName: "Maya", tripName: "Sonoma Weekend", startsOn: "2027-06-11", endsOn: "2027-06-13", question: messagingCopy.welcomeAsk }),
    "Commons: Hi Maya, this is Commons, an automated assistant for Sonoma Weekend (Jun 11 to Jun 13). Save this number as Commons. Ask me about the saved plan, or text me a booking and I'll add it for your review. Reply STOP to opt out, HELP for help.");
  assert.equal(messagingCopy.review({ tripName: "Sonoma", lines: ["Flight UA 1"], sharing: "Only you can see it.", uncertain: ["Seat"], classification: "new", code: "ABC", reviewUrl: "https://x" }),
    "Sonoma: here's what I read. Nothing is saved yet.\nFlight UA 1\nOnly you can see it.\nCheck: Seat\nReply SAVE ABC to save, or DISCARD to drop it. Edit first: https://x");
});

test("messages are worded for their channel where they are written, not rewritten after", () => {
  // Anything queued for a web thread uses copyFor(address); the SMS copy directly is only for what can only go to a phone.
  const dir = new URL(".", import.meta.url);
  const direct = readdirSync(dir).filter(file => file.endsWith(".ts") && !file.includes(".test.") && !["core.ts", "phone-verification.ts"].includes(file)).filter(file => /\bmessagingCopy\b/.test(readFileSync(new URL(file, dir), "utf8")));
  assert.deepEqual(direct, []);
});

test("the thread and its consent page say what is true", () => {
  const source = (path: string) => readFileSync(new URL(`../../../app/messages/${path}`, import.meta.url), "utf8");
  const thread = source("web-thread.tsx"), page = source("trip/[slug]/page.tsx"), form = source("trip/[slug]/web-messages-form.tsx");
  assert.match(thread, /thread\.waitingForMorning \? <p className="entry-footnote" role="status">Commons has a message for you\. It’s quiet hours for that trip, so it arrives in the morning\.<\/p>/);
  assert.match(thread, /Nothing yet\. Commons will write when there’s something to ask\./);
  assert.match(thread, /messageParts\(body, siteOrigin\)/, "Commons's links are split by the same-origin helper");
  assert.match(thread, /hydrated \? time\(message\.at\) : null/, "times are written only after hydration");
  assert.match(page, /Nothing is texted to you, and nothing you send is posted to the group\.\{emailNotice \? " When something new is waiting, Commons sends you one short email until you’ve read it\. You can turn that off in your profile\." : null\}/);
  assert.doesNotMatch(page, /nothing goes to your phone/);
  assert.match(form, /on \? "Go to the trip" : "Not now, go to the trip"/);
  assert.equal(form.match(/Messages are on for/g)?.length, 1, "the on confirmation is written once");
});

test("the full conversation in Commons: welcome, attendance, a poll, the plan, money, STOP and START, and no SMS", { skip }, async () => {
  const w = await setup();
  try {
    actAs(w.ids.maya);
    assert.deepEqual((await read()).body?.messages, []);
    const on = await turnOn(w);
    assert.equal(on.status, 200, JSON.stringify(on.body));
    assert.equal(on.body?.on, true);
    const welcomed = await read();
    assert.match(latest(welcomed), /^Hi Maya, this is Commons/); assert.match(latest(welcomed), /are you in/i);
    assert.doesNotMatch(latest(welcomed), /Save this number|Reply STOP/);
    assert.ok(w.notices >= 1, "delivering the welcome to the thread asks for an email notice");

    assert.match(replyTo(await send("yes"), "yes"), /You're in for Sonoma Weekend/);
    assert.equal(await w.attendance("maya", "sonoma"), "attending");

    const questionId = randomUUID(), saturday = randomUUID(), sunday = randomUUID();
    const poll = await createCommonsPoll(w.slugs.sonoma, { commandId: randomUUID(), title: "Dinner", ballotMode: "transparent", audience: { personIds: [w.ids.maya], guestEmails: [] }, questions: [{ id: questionId, kind: "choice", prompt: "Which night?", required: true, selectionMode: "single", options: [{ id: saturday, label: "Saturday", exclusive: false }, { id: sunday, label: "Sunday", exclusive: false }] }] }, { databaseUrl: w.url, actorPersonId: w.ids.casey });
    w.clock.advance(7 * 3_600_000);
    assert.match(latest(await read()), /Which night\?/, "opening Messages catches up on what's due");
    assert.match(replyTo(await send("sunday please"), "sunday please"), /recorded "Sunday"/);
    const [response] = await w.q(db => db.select().from(pollResponses).where(eq(pollResponses.pollId, poll.id)));
    assert.deepEqual(response!.answers[0]!.optionIds, [sunday]);

    await w.addStay("sonoma", "Vineyard Cottage", "12 Grape Rd", [w.ids.maya]);
    assert.match(replyTo(await send("what's the address?"), "what's the address?"), /12 Grape Rd/);

    const summary = replyTo(await send("I covered dinner, $120, me and Sam"), "I covered dinner, $120, me and Sam");
    assert.match(summary, /Nothing is saved yet/);
    const code = /SAVE ([A-Z0-9]{3})/.exec(summary)![1]!;
    assert.equal((await w.q(db => db.select().from(expenses).where(eq(expenses.commonsId, w.ids.sonoma)))).length, 0);
    assert.match(replyTo(await send(`SAVE ${code}`), `SAVE ${code}`), /I added Dinner/);
    assert.equal((await w.q(db => db.select().from(expenses).where(eq(expenses.commonsId, w.ids.sonoma)))).length, 1);

    // STOP is answered in the thread, and then nothing answers until START.
    assert.match(replyTo(await send("STOP"), "STOP"), /you're unsubscribed/i);
    const quiet = await send("when do we leave?");
    assert.equal(quiet.body?.messages.at(-1).from, "you");
    assert.equal(quiet.body?.optedOut, true);
    assert.match(replyTo(await send("START"), "START"), /back on/);
    assert.match(replyTo(await send("where are we staying"), "where are we staying"), /Vineyard Cottage|12 Grape Rd/);

    assert.equal(w.provider.outbox.length, 0, "nothing went through the SMS provider");
    const rows = await w.q(db => db.select().from(messagingMessages).where(eq(messagingMessages.phoneHash, phoneHashOf(webAddressFor(w.ids.maya)))));
    assert.ok(rows.filter(row => row.direction === "outbound").every(row => row.provider === "web"));
  } finally { await teardown(w); }
});

test("a thread is private to its person", { skip }, async () => {
  const w = await setup();
  try {
    actAs(w.ids.maya);
    await turnOn(w);
    await send("what's next?");
    actAs(w.ids.sam);
    assert.deepEqual((await read()).body?.messages, [], "Sam sees none of Maya's thread");
    await send("hello");
    actAs(w.ids.maya);
    assert.ok(!(await read()).body?.messages.some((message: { body: string }) => message.body === "hello"));
  } finally { await teardown(w); }
});

test("a welcome held for quiet hours shows as waiting, never as sent, and is listed in the morning", { skip }, async () => {
  const w = await setup();
  try {
    actAs(w.ids.maya);
    assert.equal((await read()).body?.waitingForMorning, false, "nothing is on yet, so nothing waits");
    w.clock.set("2026-11-05T07:00:00Z"); // 23:00 in Los Angeles
    assert.equal((await turnOn(w)).status, 200);
    const night = await read();
    assert.equal(night.body?.waitingForMorning, true);
    assert.equal(night.body?.messages.filter((message: { from: string }) => message.from === "commons").length, 0, "the held welcome isn't listed");
    assert.ok(!JSON.stringify(night.body).includes("this is Commons"), "the held message's words aren't in the thread");
    w.clock.set("2026-11-05T17:00:00Z"); // 09:00 in Los Angeles
    const morning = await read();
    assert.match(latest(morning), /^Hi Maya, this is Commons/);
    assert.equal(morning.body?.waitingForMorning, false);
  } finally { await teardown(w); }
});

const questionsOf = (w: World, personId: string) => w.q(db => db.select().from(messagingQuestions).where(eq(messagingQuestions.personId, personId)));
/** Both travelers turned messages on (each got a welcome and a first question); their questions are then closed so the next catch-up has something to plan. */
async function bothOnWithNothingOpen(w: World) {
  actAs(w.ids.maya); await turnOn(w);
  actAs(w.ids.sam); await turnOn(w);
  await w.q(db => db.update(messagingQuestions).set({ status: "expired" }).where(inArray(messagingQuestions.personId, [w.ids.maya, w.ids.sam])));
}

test("opening Messages catches up for the viewer only, not for the rest of the trip", { skip }, async () => {
  const w = await setup();
  try {
    await bothOnWithNothingOpen(w);
    const [mayaBefore, samBefore] = [(await questionsOf(w, w.ids.maya)).length, (await questionsOf(w, w.ids.sam)).length];
    actAs(w.ids.maya);
    assert.equal((await read()).status, 200);
    assert.equal((await questionsOf(w, w.ids.maya)).filter(question => question.status === "open").length, 1, "Maya's next question is asked");
    assert.equal((await questionsOf(w, w.ids.maya)).length, mayaBefore + 1);
    assert.equal((await questionsOf(w, w.ids.sam)).length, samBefore, "nothing is opened for Sam");
    assert.equal((await questionsOf(w, w.ids.sam)).filter(question => question.status === "open").length, 0);
  } finally { await teardown(w); }
});

test("a failure while catching up still returns the thread", { skip }, async () => {
  const w = await setup();
  const warn = console.warn, warned: unknown[][] = [];
  try {
    actAs(w.ids.maya); await turnOn(w);
    assert.match(latest(await read()), /this is Commons/);
    // A provider that blows up when the send pass inspects it: catching up must not take the thread down with it.
    w.useProvider(Object.create(w.provider, { synthetic: { get() { throw new TypeError("provider unavailable"); } } }));
    console.warn = (...args: unknown[]) => { warned.push(args); };
    const result = await read();
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.match(latest(result), /this is Commons/, "what was already said is still there");
    assert.ok(warned.some(args => args[0] === "commons.messaging.catch_up_dispatch_failed" && JSON.stringify(args[1]) === JSON.stringify({ error: "TypeError" })), JSON.stringify(warned));
  } finally { console.warn = warn; await teardown(w); }
});

test("two opens of Messages at once leave one open question and both succeed", { skip }, async () => {
  const w = await setup();
  const warn = console.warn, warned: unknown[][] = [];
  try {
    await bothOnWithNothingOpen(w);
    actAs(w.ids.maya);
    console.warn = (...args: unknown[]) => { warned.push(args); };
    const results = await Promise.all([read(), read(), read(), read()]);
    assert.deepEqual(results.map(result => result.status), [200, 200, 200, 200]);
    assert.deepEqual(warned, [], "the loser of the race treats the question as already asked; it isn't a failure that catching up swallows");
    assert.equal((await questionsOf(w, w.ids.maya)).filter(question => question.status === "open" && question.kind === "attendance").length, 1);
  } finally { console.warn = warn; await teardown(w); }
});

test("turning on messages in Commons moves a trip off the phone", { skip }, async () => {
  const w = await setup();
  try {
    const routes = await (await import("./test-world")).loadRoutes();
    assert.equal((await w.enroll(routes, "maya", "sonoma")).status, 200);
    actAs(w.ids.maya);
    const before = await (await tripRoute()).GET(new Request("http://localhost/x"), { params: Promise.resolve({ slug: w.slugs.sonoma }) });
    assert.equal((await json(before)).body?.onPhone, true);
    assert.equal((await turnOn(w)).body?.on, true);
    assert.equal((await enrollmentStatus(w.ids.maya, w.ids.sonoma, { databaseUrl: w.url })).onWeb, true);
    assert.deepEqual((await enrolledTripsForNumber(w.phones.maya, { databaseUrl: w.url })).trips, [], "a text from the phone no longer acts on the trip");
    assert.match(latest(await read()), /this is Commons/, "the trip says hello again in its new place");
    assert.equal((await forTrip(w, "sonoma", { on: false })).body?.on, false);
  } finally { await teardown(w); }
});

test("an organizer shares a message into each enrolled traveler's thread, a few times a day, outside quiet hours", { skip }, async () => {
  const w = await setup();
  try {
    actAs(w.ids.maya); await turnOn(w);
    actAs(w.ids.sam); await turnOn(w);
    actAs(w.ids.maya);
    assert.equal((await share(w, "Hi")).status, 403, "only an organizer can share");

    actAs(w.ids.casey);
    const id = randomUUID();
    const sent = await share(w, "Dinner moved to 7. Bring a jacket.", id);
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    assert.equal(sent.body?.recipients, 2);
    await share(w, "Dinner moved to 7. Bring a jacket.", id); // a retry is the same share
    for (const who of ["maya", "sam"] as const) {
      actAs(w.ids[who]);
      const body = latest(await read());
      assert.match(body, /^Sonoma Weekend, from Casey Synthetic \(organizer\): Dinner moved to 7\. Bring a jacket\.\nReplies come to Commons, not Casey\.$/);
      assert.equal((await read()).body?.messages.filter((message: { body: string }) => message.body.includes("Dinner moved to 7")).length, 1);
    }
    actAs(w.ids.casey);
    assert.deepEqual((await read()).body?.messages, [], "the organizer's own thread doesn't get it");

    // At night (trip time) it waits for morning, and appears then.
    w.clock.set("2026-11-05T07:00:00Z"); // 23:00 in Los Angeles
    assert.equal((await share(w, "Second note")).status, 200);
    actAs(w.ids.maya);
    assert.doesNotMatch(latest(await read()), /Second note/, "held overnight, so not shown yet");
    w.clock.set("2026-11-05T17:00:00Z"); // 09:00 in Los Angeles
    assert.match(latest(await read()), /Second note/);

    actAs(w.ids.casey);
    assert.equal((await share(w, "Third note")).status, 200);
    const limited = await share(w, "Fourth note");
    assert.equal(limited.status, 409);
    assert.equal(limited.body?.error?.code, "share_limit");
    assert.equal(w.provider.outbox.length, 0);
  } finally { await teardown(w); }
});

test("an organizer's own words arrive in a traveler's thread exactly as written", { skip }, async () => {
  const w = await setup();
  try {
    actAs(w.ids.maya); await turnOn(w);
    actAs(w.ids.casey);
    const words = "Text me when you land. We'll vote by text. Reply STOP to opt out.";
    assert.equal((await share(w, words)).status, 200);
    actAs(w.ids.maya);
    assert.equal(latest(await read()), `Sonoma Weekend, from Casey Synthetic (organizer): ${words}\nReplies come to Commons, not Casey.`);
  } finally { await teardown(w); }
});

test("a poll's own words are asked in the thread as written", { skip }, async () => {
  const w = await setup();
  try {
    actAs(w.ids.maya);
    await turnOn(w);
    await send("yes");
    const questionId = randomUUID(), first = randomUUID(), second = randomUUID();
    await createCommonsPoll(w.slugs.sonoma, { commandId: randomUUID(), title: "Dinner by text", ballotMode: "transparent", audience: { personIds: [w.ids.maya], guestEmails: [] }, questions: [{ id: questionId, kind: "choice", prompt: "Text me: which night works by text?", required: true, selectionMode: "single", options: [{ id: first, label: "Text me Saturday", exclusive: false }, { id: second, label: "Sunday by text", exclusive: false }] }] }, { databaseUrl: w.url, actorPersonId: w.ids.casey });
    w.clock.advance(7 * 3_600_000);
    assert.equal(latest(await read()), "Sonoma Weekend: Text me: which night works by text?\n1) Text me Saturday\n2) Sunday by text\nReply with 1, 2.");
    assert.match(replyTo(await send("2"), "2"), /^Got it\. I recorded "Sunday by text" for Sonoma Weekend\./);
  } finally { await teardown(w); }
});

test("STOP and START in a thread are answered and recorded for the web", { skip }, async () => {
  const w = await setup();
  try {
    actAs(w.ids.maya);
    await turnOn(w);
    const stopped = replyTo(await send("STOP"), "STOP");
    assert.equal(stopped, "You're unsubscribed and won't get more messages from Commons. Send START to turn them back on.");
    assert.doesNotMatch(stopped, /\btexts?\b/i);
    assert.match(replyTo(await send("START"), "START"), /^You're back on\./);
    const consents = (await w.q(db => db.select().from(messagingConsents).where(eq(messagingConsents.phoneHash, phoneHashOf(webAddressFor(w.ids.maya)))))).filter(row => row.status === "granted");
    assert.ok(consents.length > 0);
    assert.ok(consents.every(row => row.wording === "web-v1" && row.method === "web_reply"), JSON.stringify(consents.map(row => [row.wording, row.method])));
  } finally { await teardown(w); }
});
