import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createCommonsPoll, itineraryItems, pollResponses, setEventAttendance, submitPublicPollResponseByPublicId } from "@commons/database";
import { loadRoutes, skip, world } from "./test-world";

/* Synthetic evidence: real routes and repositories on a disposable database, with the fake provider. No message leaves the process. */
const services = async () => ({ ...(await import("./core")), ...(await import("./planner")), ...(await import("./dispatch")) });
const choice = (selectionMode: "single" | "multiple", labels: string[], extra: Record<string, unknown> = {}) => {
  const id = randomUUID(), options = labels.map(label => ({ id: randomUUID(), label, exclusive: label === "None of these" }));
  return { question: { id, kind: "choice", prompt: "Which night for the group dinner?", required: true, selectionMode, options, ...extra }, options };
};
async function settled(w: Awaited<ReturnType<typeof world>>, routes: Awaited<ReturnType<typeof loadRoutes>>) {
  await w.enroll(routes, "maya", "sonoma");
  await w.text(routes, w.phones.maya, "yes"); // answers the attendance question, so a poll is next
}

test("a multi-select poll: every option that works is recorded, one unclear part records nothing", { skip }, async () => {
  const w = await world();
  try {
    const routes = await loadRoutes(), { messagingDeps, planQuestions, dispatchOutbox } = await services();
    await settled(w, routes);
    const { question, options } = choice("multiple", ["Saturday", "Sunday", "Monday", "None of these"]);
    const poll = await createCommonsPoll(w.slugs.sonoma, { commandId: randomUUID(), title: "Dinner", ballotMode: "transparent", audience: { personIds: [w.ids.maya], guestEmails: [] }, questions: [question] }, { databaseUrl: w.url, actorPersonId: w.ids.casey });
    const deps = await messagingDeps();
    w.clock.advance(7 * 3_600_000);
    assert.equal(await planQuestions(deps), 1); await dispatchOutbox(deps);
    assert.match(w.last(), /Reply with all that work, like 1, 2/);
    const responses = () => w.q(db => db.select().from(pollResponses).where(eq(pollResponses.pollId, poll.id)));

    await w.text(routes, w.phones.maya, "1 and banana");
    assert.match(w.last(), /reply with all that work/i); assert.equal((await responses()).length, 0);
    await w.text(routes, w.phones.maya, "1 and 4");
    assert.equal((await responses()).length, 0, "None of these can't be combined");
    await w.text(routes, w.phones.maya, "1, 3");
    const [saved] = await responses();
    assert.deepEqual(saved!.answers[0]!.optionIds, [options[0]!.id, options[2]!.id]);
    assert.match(w.last(), /recorded "Saturday" and "Monday"/);
    assert.match(w.last(), new RegExp(`https://commons\\.test/c/poll/${poll.publicId}`), "the change link is the poll's real address");
  } finally { await w.cleanup(); }
});

test("saying no, or asking about an option, never casts a vote, and the question still gets answered", { skip }, async () => {
  const w = await world();
  try {
    const routes = await loadRoutes(), { messagingDeps, planQuestions, dispatchOutbox } = await services();
    await settled(w, routes);
    const { question, options } = choice("single", ["Saturday", "Sunday"]);
    const poll = await createCommonsPoll(w.slugs.sonoma, { commandId: randomUUID(), title: "Dinner", ballotMode: "transparent", audience: { personIds: [w.ids.maya], guestEmails: [] }, questions: [question] }, { databaseUrl: w.url, actorPersonId: w.ids.casey });
    const deps = await messagingDeps();
    w.clock.advance(7 * 3_600_000);
    assert.equal(await planQuestions(deps), 1); await dispatchOutbox(deps);
    const responses = () => w.q(db => db.select().from(pollResponses).where(eq(pollResponses.pollId, poll.id)));
    await w.text(routes, w.phones.maya, "Saturday doesn't work");
    assert.equal((await responses()).length, 0); assert.match(w.last(), /reply with 1, 2/i);
    await w.text(routes, w.phones.maya, "what's the plan for Saturday?");
    assert.equal((await responses()).length, 0); assert.match(w.last(), /Nothing is saved for|from the saved plan/);
    await w.text(routes, w.phones.maya, "2");
    assert.deepEqual((await responses())[0]!.answers[0]!.optionIds, [options[1]!.id]);
  } finally { await w.cleanup(); }
});

test("a poll with an optional written question can still be answered by text", { skip }, async () => {
  const w = await world();
  try {
    const routes = await loadRoutes(), { messagingDeps, planQuestions, dispatchOutbox } = await services();
    await settled(w, routes);
    const { question, options } = choice("single", ["Saturday", "Sunday"]);
    const poll = await createCommonsPoll(w.slugs.sonoma, { commandId: randomUUID(), title: "Dinner", ballotMode: "transparent", audience: { personIds: [w.ids.maya], guestEmails: [] }, questions: [question, { id: randomUUID(), kind: "text", prompt: "Anything else?", required: false }] }, { databaseUrl: w.url, actorPersonId: w.ids.casey });
    const deps = await messagingDeps();
    w.clock.advance(7 * 3_600_000);
    assert.equal(await planQuestions(deps), 1); await dispatchOutbox(deps);
    await w.text(routes, w.phones.maya, "sunday please");
    const [saved] = await w.q(db => db.select().from(pollResponses).where(eq(pollResponses.pollId, poll.id)));
    assert.deepEqual(saved!.answers.find(answer => answer.questionId === question.id)!.optionIds, [options[1]!.id]);
  } finally { await w.cleanup(); }
});

test("a poll too long for a text gets one link, is never re-sent, and stays home if it's already answered", { skip }, async () => {
  const w = await world();
  try {
    const routes = await loadRoutes(), { messagingDeps, planQuestions, dispatchOutbox } = await services();
    await settled(w, routes);
    const first = choice("single", ["Saturday", "Sunday"]), second = choice("single", ["Beach", "Hike"]);
    const poll = await createCommonsPoll(w.slugs.sonoma, { commandId: randomUUID(), title: "Weekend plans", ballotMode: "transparent", audience: { personIds: [w.ids.maya], guestEmails: [] }, questions: [first.question, second.question] }, { databaseUrl: w.url, actorPersonId: w.ids.casey });
    const deps = await messagingDeps();
    w.clock.advance(7 * 3_600_000);
    assert.equal(await planQuestions(deps), 1); await dispatchOutbox(deps);
    assert.match(w.last(), /"Weekend plans" is waiting for your answer/);
    assert.match(w.last(), new RegExp(`/c/poll/${poll.publicId}`));
    const sent = w.provider.outbox.filter(item => /Weekend plans/.test(item.body)).length;
    w.clock.advance(3 * 86_400_000);
    await planQuestions(deps); await dispatchOutbox(deps);
    assert.equal(w.provider.outbox.filter(item => /Weekend plans/.test(item.body)).length, sent, "said once");

    // Queued overnight, then answered on the web before morning: the text never leaves.
    const third = choice("single", ["Tacos", "Pizza"]), fourth = choice("single", ["Early", "Late"]);
    const later = await createCommonsPoll(w.slugs.sonoma, { commandId: randomUUID(), title: "Friday food", ballotMode: "transparent", audience: { personIds: [w.ids.maya], guestEmails: [] }, questions: [third.question, fourth.question] }, { databaseUrl: w.url, actorPersonId: w.ids.casey });
    w.clock.set("2026-11-09T10:00:00Z"); // 2am in the trip's time zone
    await planQuestions(deps); await dispatchOutbox(deps);
    assert.equal(w.provider.outbox.filter(item => /Friday food/.test(item.body)).length, 0, "quiet hours hold");
    await submitPublicPollResponseByPublicId(later.publicId, { respondentName: "", answers: [{ questionId: third.question.id, optionIds: [third.options[0]!.id], text: null }, { questionId: fourth.question.id, optionIds: [fourth.options[0]!.id], text: null }] }, w.url, { authUserId: w.ids.maya, email: null });
    w.clock.set("2026-11-09T17:00:00Z");
    await dispatchOutbox(deps);
    assert.equal(w.provider.outbox.filter(item => /Friday food/.test(item.body)).length, 0, "answered in the meantime, so it stays home");
    assert.ok((await w.messageRows(w.phones.maya)).some(row => row.purpose === "proactive:poll_link" && row.statusDetail === "task_resolved"));
  } finally { await w.cleanup(); }
});

test("publishing a poll texts its people right away, and a failure there can't stop the publish", { skip }, async () => {
  const w = await world();
  process.env.COMMONS_SMS_PROVIDER = "twilio"; process.env.COMMONS_SMS_SEND_MODE = "live";
  try {
    const routes = await loadRoutes(), { textAboutPublishedPoll, messagingDeps, dispatchOutbox } = await services();
    await settled(w, routes);
    const { question } = choice("single", ["Saturday", "Sunday"]);
    const poll = await createCommonsPoll(w.slugs.sonoma, { commandId: randomUUID(), title: "Dinner", ballotMode: "transparent", audience: { personIds: [w.ids.maya], guestEmails: [] }, questions: [question] }, { databaseUrl: w.url, actorPersonId: w.ids.casey });
    // With texting off nothing is planned or sent, and this returns quietly.
    delete process.env.COMMONS_SMS_PROVIDER;
    const before = w.provider.outbox.length;
    await textAboutPublishedPoll(poll.id);
    assert.equal(w.provider.outbox.length, before);
    process.env.COMMONS_SMS_PROVIDER = "twilio";
    // An unknown poll isn't an error.
    await assert.doesNotReject(textAboutPublishedPoll(randomUUID()));
    // Published at 2am in the trip's time zone: queued right away, but it waits for morning.
    w.clock.set("2026-11-05T10:00:00Z");
    await textAboutPublishedPoll(poll.id);
    assert.equal(w.provider.outbox.length, before, "quiet hours hold");
    assert.ok((await w.messageRows(w.phones.maya)).some(row => row.statusDetail === "quiet_hours"));
    w.clock.set("2026-11-05T17:00:00Z");
    await dispatchOutbox(await messagingDeps());
    assert.match(w.last(), /Which night for the group dinner/);
  } finally { delete process.env.COMMONS_SMS_PROVIDER; delete process.env.COMMONS_SMS_SEND_MODE; await w.cleanup(); }
});

test("plan questions by text, through the real route, from what this person may see", { skip }, async () => {
  const w = await world();
  try {
    const routes = await loadRoutes();
    await w.enroll(routes, "maya", "sonoma");
    await setEventAttendance(w.slugs.sonoma, { commandId: randomUUID(), state: "attending", reviewedDates: "2027-06-11/2027-06-13" }, { databaseUrl: w.url, actorPersonId: w.ids.maya });
    await w.addStay("sonoma", "Vineyard Cottage", "12 Grape Rd, Sonoma, CA", [w.ids.maya]);
    await w.q(db => db.insert(itineraryItems).values([
      { commonsId: w.ids.sonoma, title: "The Girl and the Fig", startsAt: new Date("2027-06-12T02:00:00Z"), timezone: "America/Los_Angeles", locationName: "110 W Spain St", audience: "everyone", status: "confirmed", mealType: "restaurant", provenanceLabel: "Added by Casey" },
      { commonsId: w.ids.sonoma, title: "Wine tasting", startsAt: new Date("2027-06-12T18:00:00Z"), timezone: "America/Los_Angeles", locationName: "Ram's Gate", audience: "everyone", status: "planned", provenanceLabel: "Added by Casey" },
    ]));
    await w.text(routes, w.phones.maya, "what's the address for dinner?");
    assert.match(w.last(), /from the saved plan/); assert.match(w.last(), /110 W Spain St/); assert.doesNotMatch(w.last(), /Grape/);
    await w.text(routes, w.phones.maya, "when is dinner");
    assert.match(w.last(), /Fri, Jun 11, 7:00 PM/);
    await w.text(routes, w.phones.maya, "what's planned for Saturday?");
    assert.match(w.last(), /Wine tasting/); assert.doesNotMatch(w.last(), /Fig/);
    await w.text(routes, w.phones.maya, "what's next");
    assert.match(w.last(), /Next up/); assert.match(w.last(), /Fig/);
    await w.text(routes, w.phones.maya, "when is the hike");
    assert.match(w.last(), /don't have that saved/i);
    await w.text(routes, w.phones.maya, "thanks!");
    assert.match(w.last(), /not waiting on an answer/i, "ordinary chat isn't answered as a plan question");
  } finally { await w.cleanup(); }
});
