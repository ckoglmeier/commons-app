import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { createDatabase } from "./client";
import { commons, memberships, people, pollDeliveries, pollDrafts, polls } from "./schema";
import { getPollDraftRecipientReview, listCommonsPollDrafts, saveCommonsPollDraft } from "./poll-draft-repository";
import { createCommonsPoll, getPublicPollByPublicId, submitPublicPollResponseByPublicId, updateCommonsPollStatus, getCommonsPollDetail } from "./poll-repository";
import { approvePollDecision } from "./poll-decision-repository";
import { leasePollDelivery } from "./poll-delivery-repository";
import { reservePollInference } from "./poll-inference-repository";

test("review approval is scoped, atomic, version-bound and idempotent; private history never leaves the draft", { skip: process.env.COMMONS_RUN_DATABASE_TESTS !== "1" }, async () => {
  const url = process.env.TEST_DATABASE_URL!;
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname));
  const db = createDatabase(url);
  const event = randomUUID(), org = randomUUID(), member = randomUUID();
  const options = { databaseUrl: url, actorPersonId: org };
  try {
    await db.db.insert(people).values([{ id: org, displayName: "Review QA", authUserId: org }, { id: member, displayName: "Member QA", authUserId: member }]);
    await db.db.insert(commons).values({ id: event, slug: event, name: "Review QA", createdByPersonId: org, timezone: "America/Denver" });
    await db.db.insert(memberships).values([{ commonsId: event, personId: org, role: "organizer", status: "active" }, { commonsId: event, personId: member, role: "member", status: "active" }]);
    const data = { title: "Hotel choice", intro: "Choose the hotel", ballotMode: "transparent", audience: { personIds: [], guestEmails: ["review-qa@example.test"] },
      communication: { heading: "Our next step", paragraphs: ["Choose the hotel. Book directly after the decision."], links: [] },
      questions: [{ id: randomUUID(), kind: "text", prompt: "Which hotel?", required: false }],
      review: { messages: [{ role: "user", text: "PRIVATE ORGANIZER DISCUSSION", at: new Date().toISOString() }], previous: null, lastChange: "Seeded" } };
    const draft = await saveCommonsPollDraft(event, { id: randomUUID(), commandId: randomUUID(), expectedVersion: 0, data }, options);
    const noIntro = await saveCommonsPollDraft(event, { id: randomUUID(), commandId: randomUUID(), expectedVersion: 0, data: { ...data, intro: null } }, options);
    await reservePollInference(event, { draftId: noIntro.id, version: noIntro.version }, options, "review");
    await assert.rejects(reservePollInference(event, { draftId: noIntro.id, version: noIntro.version }, { ...options, actorPersonId: member }, "review"));
    assert.equal((await listCommonsPollDrafts(event, { ...options, actorPersonId: member }, draft.id)).length, 0);
    await assert.rejects(saveCommonsPollDraft(event, { id: randomUUID(), commandId: randomUUID(), expectedVersion: 0, data }, { ...options, actorPersonId: member }));
    const recipients = await getPollDraftRecipientReview(event, draft.id, draft.version, options);
    assert.equal(recipients.recipients[0].email, "review-qa@example.test");
    const publish = { ...draft.data, commandId: randomUUID(), draftId: draft.id, draftVersion: draft.version, deliveryApproval: { approved: true, fingerprint: recipients.fingerprint } };
    await assert.rejects(createCommonsPoll(event, { ...publish, draftVersion: 99 }, options));
    await assert.rejects(createCommonsPoll(event, { ...publish, communication: { ...data.communication, heading: "Unreviewed change" } }, options));
    await assert.rejects(createCommonsPoll(event, { ...publish, deliveryApproval: { approved: true, fingerprint: "a".repeat(64) } }, options));
    assert.equal((await db.db.select().from(polls).where(eq(polls.commonsId, event))).length, 0, "failed send approval rolls back publication");
    const shareDraft = await saveCommonsPollDraft(event, { id: randomUUID(), commandId: randomUUID(), expectedVersion: 0, data: { ...data, title: "Share in my thread" } }, options);
    const shareInput = { ...shareDraft.data, audience: undefined, commandId: randomUUID(), draftId: shareDraft.id, draftVersion: shareDraft.version, shareApproval: { approved: true as const } };
    const shared = await createCommonsPoll(event, shareInput, options);
    assert.equal((await createCommonsPoll(event, shareInput, options)).id, shared.id, "copy publication is idempotent");
    assert.equal((await db.db.select().from(pollDeliveries).where(eq(pollDeliveries.pollId, shared.id))).length, 0, "copy publication never queues email");
    assert.deepEqual((await getPublicPollByPublicId(shared.publicId, url))?.communication, data.communication, "the copied public poll carries the approved message");
    const questionId = shared.questions[0].id;
    const response = await submitPublicPollResponseByPublicId(shared.publicId, { respondentName: "Synthetic traveler", answers: [{ questionId, optionIds: [], text: "An inn" }] }, url);
    assert.ok(response.receiptToken);
    await submitPublicPollResponseByPublicId(shared.publicId, { respondentName: "Synthetic traveler", receiptToken: response.receiptToken, answers: [{ questionId, optionIds: [], text: "An inn with separate beds" }] }, url);
    const results = await getCommonsPollDetail(event, shared.id, options);
    assert.equal(results?.responseCount, 1, "revision replaces the ballot rather than adding a participant");
    assert.equal(results?.responses[0].answers?.[0].text, "An inn with separate beds");
    const closed = await updateCommonsPollStatus(event, shared.id, { commandId: randomUUID(), status: "closed" }, options);
    const decision = { commandId: randomUUID(), summary: "Shortlist inns with separate beds", target: "record", selected: [], needResolutions: [], uncertaintyAcknowledged: true, audienceExpansionApproved: false, evidenceFingerprint: closed.evidenceFingerprint };
    await assert.rejects(approvePollDecision(event, shared.id, decision, { ...options, actorPersonId: member }));
    const decided = await approvePollDecision(event, shared.id, decision, options);
    assert.equal(decided.decision?.summary, decision.summary);
    assert.equal((await approvePollDecision(event, shared.id, decision, options))?.decision?.id, decided?.decision?.id);
    assert.equal((await db.db.select().from(pollDeliveries).where(eq(pollDeliveries.pollId, shared.id))).length, 0, "the full self-share flow never queues email");
    const published = await createCommonsPoll(event, publish, options);
    assert.equal((await createCommonsPoll(event, publish, options)).id, published.id);
    assert.equal((await db.db.select().from(pollDeliveries).where(eq(pollDeliveries.pollId, published.id))).length, 1);
    assert.deepEqual(published.communication, data.communication);
    assert.doesNotMatch(JSON.stringify(published), /PRIVATE ORGANIZER DISCUSSION/);
    assert.equal(await getPublicPollByPublicId(published.publicId, url), null);
    const publicResult = await getPublicPollByPublicId(published.publicId, url, { authUserId: randomUUID(), email: "review-qa@example.test" });
    assert.deepEqual(publicResult?.communication, data.communication);
    assert.doesNotMatch(JSON.stringify(publicResult), /PRIVATE ORGANIZER DISCUSSION/);
    const job = await leasePollDelivery(url, published.id);
    assert.ok(job && !job.skipped);
    assert.deepEqual(job.content.communication, data.communication);
    assert.equal(job.content.title, data.title);
    assert.doesNotMatch(JSON.stringify(job), /PRIVATE ORGANIZER DISCUSSION/);
    await assert.rejects(saveCommonsPollDraft(event, { id: draft.id, commandId: randomUUID(), expectedVersion: draft.version, data: { ...data, title: "After approval" } }, options));
    assert.equal((await db.db.select().from(pollDrafts).where(eq(pollDrafts.id, draft.id)))[0].data.title, data.title);
  } finally {
    await db.db.delete(commons).where(eq(commons.id, event));
    await db.db.delete(people).where(inArray(people.id, [org, member]));
    await db.close();
  }
});
