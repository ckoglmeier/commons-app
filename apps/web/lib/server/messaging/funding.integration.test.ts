import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { commons, eventCreationDrafts, people, messagingConsents, messagingQuestions, phoneHashOf, sendEligibility, tripActivationPayments, tripTextingFunded } from "@commons/database";
import { json, loadRoutes, skip, world, type World } from "./test-world";

/*
 * Texting follows the trip fee (#7 "funding checks"): a trip that needs the $20 fee can't turn texts on, plan questions, send, or act on replies
 * until it is paid. Saved consent survives, so texting resumes on its own once the fee is settled. Synthetic people, fake provider, disposable database.
 */
const get = () => new Request("http://localhost/x");

async function requireFee(w: World) {
  const draftId = randomUUID();
  await w.q(async db => {
    await db.insert(eventCreationDrafts).values({ id: draftId, createdByPersonId: w.ids.casey, status: "committed", sourceKind: "blank", timezone: "America/Los_Angeles", betaActivationRequired: true, brief: {} } as never);
    await db.update(commons).set({ activationDraftId: draftId }).where(eq(commons.id, w.ids.sonoma));
    // Accounts are fee-exempt by default; Casey is one who pays.
    await db.update(people).set({ doNotCharge: false }).where(eq(people.id, w.ids.casey));
  });
  return {
    draftId,
    pay: () => w.q(db => db.insert(tripActivationPayments).values({ draftId, organizerId: w.ids.casey, status: "paid", paidAt: new Date() })),
    unpay: () => w.q(db => db.delete(tripActivationPayments).where(eq(tripActivationPayments.draftId, draftId))),
    cleanup: () => w.q(async db => {
      await db.update(commons).set({ activationDraftId: null }).where(eq(commons.id, w.ids.sonoma));
      await db.delete(tripActivationPayments).where(eq(tripActivationPayments.draftId, draftId));
      await db.delete(eventCreationDrafts).where(eq(eventCreationDrafts.id, draftId));
    }),
  };
}

test("a trip that needs no fee can text, as before", { skip }, async () => {
  const w = await world();
  try {
    assert.equal(await tripTextingFunded(w.ids.sonoma, { databaseUrl: w.url }), true);
    const routes = await loadRoutes();
    assert.equal((await w.enroll(routes, "maya", "sonoma")).status, 200);
    assert.equal(w.provider.outbox.length, 1, "the welcome goes out");
  } finally { await w.cleanup(); }
});

test("an unpaid trip can't turn texts on; once paid it can", { skip }, async () => {
  const w = await world();
  const fee = await requireFee(w);
  try {
    const routes = await loadRoutes();
    const refused = await json(await w.enroll(routes, "maya", "sonoma"));
    assert.equal(refused.status, 409);
    assert.equal(refused.body?.error?.code, "trip_not_funded");
    assert.equal((await w.q(db => db.select().from(messagingConsents).where(eq(messagingConsents.personId, w.ids.maya)))).length, 0, "no consent is stored");
    assert.equal(w.provider.outbox.length, 0, "nothing is sent");
    const status = await json(await routes.enrollment.GET(get(), { params: Promise.resolve({ slug: w.slugs.sonoma }) }));
    assert.equal(status.body?.funded, false, "the page can say why");

    await fee.pay();
    const enrolled = await json(await w.enroll(routes, "maya", "sonoma"));
    assert.equal(enrolled.status, 200);
    assert.equal(enrolled.body?.welcomeQueued, true);
    assert.equal(w.provider.outbox.length, 1);
  } finally { await fee.cleanup(); await w.cleanup(); }
});

test("when the fee stops being settled, nothing is sent or acted on; settling it resumes texting", { skip }, async () => {
  const w = await world();
  const fee = await requireFee(w);
  try {
    const routes = await loadRoutes();
    await fee.pay();
    assert.equal((await w.enroll(routes, "maya", "sonoma")).status, 200);
    const sentBefore = w.provider.outbox.length;
    const consent = { personId: w.ids.maya, commonsId: w.ids.sonoma, phoneHash: phoneHashOf(w.phones.maya), scope: "conversation" as const };
    assert.equal((await sendEligibility(consent, { databaseUrl: w.url })).ok, true);

    await fee.unpay();
    const blocked = await sendEligibility(consent, { databaseUrl: w.url });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.ok ? null : blocked.reason, "trip_not_funded", "a queued text is held back at send time");

    // A reply acts on nothing: "yes" would have answered the welcome's attendance question.
    assert.equal((await w.text(routes, w.phones.maya, "yes")).status, 204);
    assert.notEqual(await w.attendance("maya", "sonoma"), "attending");
    assert.match(w.last(), /Sonoma Weekend/); assert.match(w.last(), /trip fee is paid/); assert.match(w.last(), /Reply STOP/);
    assert.equal(w.provider.outbox.length, sentBefore + 1, "one explanation, nothing else");
    assert.equal((await w.text(routes, w.phones.maya, "yes")).status, 204);
    assert.equal(w.provider.outbox.length, sentBefore + 1, "the explanation is sent at most once a day");

    // The scheduled pass opens no new question on the trip.
    const questionsBefore = (await w.q(db => db.select().from(messagingQuestions).where(eq(messagingQuestions.personId, w.ids.maya)))).length;
    const planner = await import("./planner"), core = await import("./core");
    assert.equal(await planner.planQuestionsForTrip(await core.messagingDeps(), w.ids.sonoma), 0);
    assert.equal((await w.q(db => db.select().from(messagingQuestions).where(eq(messagingQuestions.personId, w.ids.maya)))).length, questionsBefore);
    const status = await json(await routes.enrollment.GET(get(), { params: Promise.resolve({ slug: w.slugs.sonoma }) }));
    assert.equal(status.body?.funded, false);
    assert.equal(status.body?.enrolled, true, "consent is kept for when the fee is settled");

    await fee.pay();
    assert.equal((await sendEligibility(consent, { databaseUrl: w.url })).ok, true);
    assert.equal((await w.text(routes, w.phones.maya, "yes")).status, 204);
    assert.equal(await w.attendance("maya", "sonoma"), "attending", "replies act again once paid");
  } finally { await fee.cleanup(); await w.cleanup(); }
});
