import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { createDatabase } from "./client";
import { commons, memberships, people, pollDrafts, coordinatorTurns, pollResponses, itineraryItems } from "./schema";
import { getCoordinatorThread, commitCoordinatorTurn, reserveCoordinatorInference, hasCoordinatorTurnReplay, actOnCoordinatorWorkspace, createCoordinatorThread, updateCoordinatorThread, actOnCoordinatorThreadIdea } from "./coordinator-repository";
import { saveCommonsPollDraft, getPollDraftRecipientReview, listCommonsPollDrafts, reopenCoordinatorDraft } from "./poll-draft-repository";
import { createCommonsPoll } from "./poll-repository";

test("stable goal threads retain linked ideas, research, polls, and response history across reopen", { skip: process.env.COMMONS_RUN_DATABASE_TESTS !== "1" }, async () => {
  const url = process.env.TEST_DATABASE_URL!;
  assert.equal(new URL(url).hostname, "127.0.0.1");
  const db = createDatabase(url), event = randomUUID(), owner = randomUUID(), other = randomUUID(), ideaId = randomUUID();
  const options = { databaseUrl: url, actorPersonId: owner, sharedCoordinator: true };
  try {
    await db.db.insert(people).values([{ id: owner, displayName: "Alex", authUserId: owner }, { id: other, displayName: "Sam", authUserId: other }]);
    await db.db.insert(commons).values({ id: event, slug: event, name: "Thread persistence QA", timezone: "America/Denver", createdByPersonId: owner });
    await db.db.insert(memberships).values([owner, other].map(personId => ({ commonsId: event, personId, role: "organizer" as const, status: "active" as const })));
    await db.db.insert(itineraryItems).values({ id: ideaId, commonsId: event, title: "Winery lunch", timezone: "America/Denver", audience: "everyone", status: "idea", provenanceLabel: "Suggested by Alex" });

    const create = { id: randomUUID(), commandId: randomUUID(), title: "Choose our Sonoma base" };
    const created = await createCoordinatorThread(event, create, options);
    assert.deepEqual(await createCoordinatorThread(event, create, options), created, "thread creation is idempotent");
    const link = { threadId: created.id, itineraryItemId: ideaId, commandId: randomUUID(), expectedThreadVersion: 1, action: "link" as const };
    assert.equal((await actOnCoordinatorThreadIdea(event, link, options)).version, 2);
    assert.equal((await actOnCoordinatorThreadIdea(event, link, options)).version, 2, "idea linking is idempotent");

    const questionId = randomUUID(), optionId = randomUUID();
    const draft = await saveCommonsPollDraft(event, { id: randomUUID(), commandId: randomUUID(), expectedVersion: 0, data: { title: "Lodging", intro: null, ballotMode: "transparent", communication: { heading: "Choose our base", paragraphs: ["Nothing is booked."], links: [] }, questions: [{ id: questionId, kind: "choice", selectionMode: "single", prompt: "Where?", options: [{ id: optionId, label: "Sonoma" }, { id: randomUUID(), label: "Napa" }] }] } }, options);
    const turn = { commandId: randomUUID(), version: 0, threadId: created.id, prompt: "Research Sonoma lodging", draftId: draft.id, draftVersion: draft.version, researchQuery: "Sonoma lodging" };
    const research = { query: "Sonoma lodging", status: "complete" as const, limitations: [], sources: [{ id: "source-1", title: "Sonoma", url: "https://example.com/sonoma", excerpt: "Several options", retrievedAt: new Date().toISOString(), coverage: "page" as const }] };
    await commitCoordinatorTurn(event, turn, "Here are the tradeoffs.", draft.data, options, { research });
    let goal = await getCoordinatorThread(event, { ...options, actorPersonId: other }, undefined, created.id);
    assert.equal(goal.activeThreadId, created.id);
    assert.equal(goal.turns.length, 1);
    assert.equal(goal.drafts[0].threadId, created.id);
    assert.equal(goal.linkedIdeas[0].itineraryItemId, ideaId);
    assert.equal(goal.researchRuns[0].query, research.query);
    assert.equal((await getCoordinatorThread(event, options)).turns.length, 0, "thread turns never enter the legacy shared stream");

    const published = await createCommonsPoll(event, { ...goal.drafts[0].data, commandId: randomUUID(), draftId: draft.id, draftVersion: goal.drafts[0].version, shareApproval: { approved: true } }, options);
    await db.db.insert(pollResponses).values({ pollId: published.id, respondentName: "Guest", receiptTokenHash: randomUUID(), answers: [{ questionId, optionIds: [optionId], text: null }] });
    await reopenCoordinatorDraft(event, draft.id, goal.drafts[0].version, options);
    goal = await getCoordinatorThread(event, options, undefined, created.id);
    assert.equal(goal.polls[0].threadId, created.id);
    assert.equal(goal.polls[0].responseCount, 1, "reopening preserves the published poll and its responses");
    assert.equal(goal.drafts.length, 2);

    const archived = await updateCoordinatorThread(event, { threadId: created.id, commandId: randomUUID(), expectedVersion: 2, status: "archived" }, options);
    await assert.rejects(reserveCoordinatorInference(event, { ...turn, commandId: randomUUID(), version: 1, draftId: null, draftVersion: null }, options));
    const reopened = await updateCoordinatorThread(event, { threadId: created.id, commandId: randomUUID(), expectedVersion: archived.version, status: "active" }, options);
    assert.equal(reopened.id, created.id, "reopening retains the stable goal identity");
  } finally {
    await db.db.delete(commons).where(eq(commons.id, event));
    await db.db.delete(people).where(inArray(people.id, [owner, other]));
    await db.close();
  }
});

test("shared coordinator is accessible to all active organizers only, with attribution and legacy privacy", { skip: process.env.COMMONS_RUN_DATABASE_TESTS !== "1" }, async () => {
  const url = process.env.TEST_DATABASE_URL!;
  assert.equal(new URL(url).hostname, "127.0.0.1");
  const db = createDatabase(url), event = randomUUID(), elsewhere = randomUUID(), org = randomUUID(), coorg = randomUUID(), member = randomUUID();
  const a = { databaseUrl: url, actorPersonId: org, sharedCoordinator: true };
  const b = { ...a, actorPersonId: coorg }, participant = { ...a, actorPersonId: member };
  try {
    await db.db.insert(people).values([{ id: org, displayName: "Alex", authUserId: org }, { id: coorg, displayName: "Sam", authUserId: coorg }, { id: member, displayName: "Taylor", authUserId: member }]);
    await db.db.insert(commons).values([event, elsewhere].map(id => ({ id, slug: id, name: "Shared coordinator QA", timezone: "America/Denver", createdByPersonId: org })));
    await db.db.insert(memberships).values([{ commonsId: event, personId: org, role: "organizer", status: "active" }, { commonsId: event, personId: coorg, role: "organizer", status: "active" }, { commonsId: event, personId: member, role: "member", status: "active" }, { commonsId: elsewhere, personId: coorg, role: "organizer", status: "active" }]);
    const data = { title: "Stay", intro: null, ballotMode: "transparent", communication: { heading: "Choose our base", paragraphs: ["Not booked."], links: [] }, questions: [{ id: randomUUID(), kind: "choice", selectionMode: "single", prompt: "Where?", options: [{ id: randomUUID(), label: "Inn" }, { id: randomUUID(), label: "House" }] }] };
    const old = await saveCommonsPollDraft(event, { id: randomUUID(), commandId: randomUUID(), expectedVersion: 0, data }, { ...a, sharedCoordinator: false });
    await commitCoordinatorTurn(event, { commandId: randomUUID(), version: 0, prompt: "Legacy private", draftId: null, draftVersion: null }, "Private reply", null, { ...a, sharedCoordinator: false });
    const draft = await saveCommonsPollDraft(event, { id: randomUUID(), commandId: randomUUID(), expectedVersion: 0, data }, a);
    assert.deepEqual((await getCoordinatorThread(event, b)).drafts.map(d => d.id), [draft.id]);
    assert.equal((await getCoordinatorThread(event, a)).turns.length, 0);
    assert.equal((await getCoordinatorThread(event, { ...a, sharedCoordinator: false })).turns.length, 1);
    assert.equal((await listCommonsPollDrafts(event, b, old.id)).length, 0);
    assert.equal((await listCommonsPollDrafts(event, participant, draft.id)).length, 0);
    await assert.rejects(getCoordinatorThread(event, participant));
    await assert.rejects(getPollDraftRecipientReview(event, draft.id, 1, participant));
    await assert.rejects(saveCommonsPollDraft(event, { id: draft.id, commandId: randomUUID(), expectedVersion: 1, data: draft.data }, participant));
    const next = { ...draft.data, title: "Choose our base" };
    const input = { commandId: randomUUID(), version: 0, prompt: "Warmer title", draftId: draft.id, draftVersion: 1 };
    await commitCoordinatorTurn(event, input, "Proposed, not applied", next, a, { saved: true, research: { query: "Sonoma hotels", status: "partial", sources: [], limitations: ["Synthetic QA"] }, proposal: { baseVersion: 1, data: next, changes: ["title"], state: "pending" } });
    let thread = await getCoordinatorThread(event, b);
    assert.equal(thread.turns[0].authorName, "Alex");
    assert.equal(thread.turns[0].workspace?.research?.query, "Sonoma hotels");
    assert.equal(thread.drafts[0].version, 1);
    const action = { commandId: randomUUID(), turnId: thread.turns[0].id, action: "apply" };
    await assert.rejects(actOnCoordinatorWorkspace(event, action, participant));
    await assert.rejects(actOnCoordinatorWorkspace(elsewhere, action, b));
    await actOnCoordinatorWorkspace(event, action, b);
    await actOnCoordinatorWorkspace(event, action, b);
    thread = await getCoordinatorThread(event, a);
    assert.equal(thread.drafts[0].version, 2);
    assert.equal(thread.turns[0].workspace?.actedBy?.name, "Sam");
    await assert.rejects(commitCoordinatorTurn(event, { ...input, commandId: randomUUID() }, "Stale organizer", next, b, {}));
    const followup = { commandId: randomUUID(), version: 1, prompt: "More about this note", draftId: null, draftVersion: null, contextTurnId: thread.turns[0].id };
    await commitCoordinatorTurn(event, followup, "Another organizer’s reply", null, b, {});
    assert.equal((await getCoordinatorThread(event, a)).turns[1].authorName, "Sam");
    await assert.rejects(commitCoordinatorTurn(elsewhere, { ...followup, commandId: randomUUID(), version: 0 }, "Foreign note", null, b, {}));
    await db.db.update(memberships).set({ role: "member" }).where(and(eq(memberships.commonsId, event), eq(memberships.personId, org)));
    await assert.rejects(getCoordinatorThread(event, a));
    assert.equal((await listCommonsPollDrafts(event, a, draft.id)).length, 0, "demoted author cannot read the organizers’ draft");
    await assert.rejects(saveCommonsPollDraft(event, { id: draft.id, commandId: randomUUID(), expectedVersion: 2, data: next }, a));
    const latest = (await getCoordinatorThread(event, b)).drafts[0];
    const published = await createCommonsPoll(event, { ...latest.data, commandId: randomUUID(), draftId: latest.id, draftVersion: latest.version, shareApproval: { approved: true } }, b);
    assert.doesNotMatch(JSON.stringify(published), /Legacy private|Synthetic QA|Warmer title|Another organizer/);
    await db.db.update(memberships).set({ status: "left" }).where(and(eq(memberships.commonsId, event), eq(memberships.personId, coorg)));
    await assert.rejects(getCoordinatorThread(event, b));
    await assert.rejects(actOnCoordinatorWorkspace(event, action, b));
    assert.equal((await listCommonsPollDrafts(event, participant, draft.id)).length, 0);
  } finally {
    await db.db.delete(commons).where(inArray(commons.id, [event, elsewhere]));
    await db.db.delete(people).where(inArray(people.id, [org, coorg, member]));
    await db.close();
  }
});

test("one private organizer thread carries artifacts and conversation across publication without cross-person or cross-trip access", { skip: process.env.COMMONS_RUN_DATABASE_TESTS !== "1" }, async () => {
  const url = process.env.TEST_DATABASE_URL!;
  assert.equal(new URL(url).hostname, "127.0.0.1");
  const db = createDatabase(url), event = randomUUID(), otherEvent = randomUUID(), org = randomUUID(), coorg = randomUUID(), member = randomUUID();
  const options = { databaseUrl: url, actorPersonId: org };
  try {
    await db.db.insert(people).values([org, coorg, member].map(id => ({ id, displayName: "Thread QA", authUserId: id })));
    await db.db.insert(commons).values([event, otherEvent].map(id => ({ id, slug: id, name: "Thread QA", timezone: "America/Denver", createdByPersonId: org })));
    await db.db.insert(memberships).values([{ commonsId: event, personId: org, role: "organizer", status: "active" }, { commonsId: otherEvent, personId: org, role: "organizer", status: "active" }, { commonsId: event, personId: coorg, role: "organizer", status: "active" }, { commonsId: event, personId: member, role: "member", status: "active" }]);
    const questionId = randomUUID(), optionId = randomUUID(), otherOptionId = randomUUID();
    const draft = await saveCommonsPollDraft(event, { id: randomUUID(), commandId: randomUUID(), expectedVersion: 0, data: { title: "Lodging", intro: null, ballotMode: "transparent", audience: { personIds: [], guestEmails: ["thread-test@example.test"] }, communication: { heading: "Choose a base", paragraphs: ["Everyone books directly."], links: [] }, questions: [{ id: questionId, kind: "choice", selectionMode: "single", prompt: "What works?", options: [{ id: optionId, label: "Sonoma" }, { id: otherOptionId, label: "Napa" }] }] } }, options);
    const input = { commandId: randomUUID(), version: 0, prompt: "PRIVATE: discuss the hotel", draftId: draft.id, draftVersion: draft.version };
    await assert.rejects(getCoordinatorThread(event, { ...options, actorPersonId: member }));
    await assert.rejects(commitCoordinatorTurn(otherEvent, input, "Reply", draft.data, options));
    await assert.rejects(commitCoordinatorTurn(event, input, "Reply", draft.data, { ...options, actorPersonId: coorg }));
    await reserveCoordinatorInference(event, input, options);
    const next = { ...draft.data, title: "Choose our hotel" };
    await commitCoordinatorTurn(event, input, "PRIVATE: here is the updated draft", next, options);
    await commitCoordinatorTurn(event, input, "Not duplicated", next, options);
    assert.equal(await hasCoordinatorTurnReplay(event, input, options), true);
    assert.deepEqual(await reserveCoordinatorInference(event, input, options), { replayed: true });
    assert.equal((await db.db.select().from(coordinatorTurns).where(eq(coordinatorTurns.commonsId, event))).length, 1);
    await assert.rejects(commitCoordinatorTurn(event, { ...input, prompt: "Changed retry" }, "No", next, options));
    const current = await getCoordinatorThread(event, options);
    assert.equal(current.version, 1);
    assert.equal(current.drafts[0].data.title, next.title);
    assert.equal(current.turns[0].draftId, draft.id);
    assert.equal((await getCoordinatorThread(event, { ...options, actorPersonId: coorg })).turns.length, 0);
    assert.equal((await getCoordinatorThread(otherEvent, options)).turns.length, 0);
    await assert.rejects(commitCoordinatorTurn(event, { ...input, commandId: randomUUID() }, "Stale", next, options));
    assert.equal((await getCoordinatorThread(event, options)).version, 1);
    const saved = current.drafts[0];
    const recipients = await getPollDraftRecipientReview(event, saved.id, saved.version, options);
    const published = await createCommonsPoll(event, { ...saved.data, commandId: randomUUID(), draftId: saved.id, draftVersion: saved.version, deliveryApproval: { approved: true, fingerprint: recipients.fingerprint } }, options);
    await db.db.insert(pollResponses).values({ pollId: published.id, respondentName: "Not exposed in the thread", receiptTokenHash: randomUUID(), answers: [{ questionId, optionIds: [optionId], text: null }] });
    assert.doesNotMatch(JSON.stringify(published), /PRIVATE/);
    const followup = { commandId: randomUUID(), version: 1, prompt: "What comes next?", draftId: null, draftVersion: null };
    await reserveCoordinatorInference(event, followup, options);
    await commitCoordinatorTurn(event, followup, "The poll is published; wait for the group’s responses.", null, options);
    const after = await getCoordinatorThread(event, options);
    assert.equal(after.turns.length, 2);
    assert.equal(after.polls[0].id, published.id);
    assert.equal(after.polls[0].publicId, published.publicId);
    assert.equal(after.polls[0].audienceRestricted, true, "published delivery polls retain their real recipient restriction");
    assert.equal(after.polls[0].responseCount, 1);
    assert.equal(after.polls[0].resultsVisible, true);
    assert.deepEqual(after.polls[0].results, [{ questionId, prompt: "What works?", options: [{ optionId, label: "Sonoma", count: 1 }, { optionId: otherOptionId, label: "Napa", count: 0 }], textResponseCount: 0 }]);
    assert.doesNotMatch(JSON.stringify(after.polls[0]), /Not exposed/);
    assert.equal(after.drafts[0].publishedPollId, published.id);
    await assert.rejects(commitCoordinatorTurn(event, { ...input, commandId: randomUUID(), version: 2, draftVersion: saved.version }, "Cannot edit published artifact", next, options));
    assert.equal((await getCoordinatorThread(event, options)).version, 2);
    await db.db.update(memberships).set({ status: "left" }).where(and(eq(memberships.commonsId, event), eq(memberships.personId, org)));
    await assert.rejects(hasCoordinatorTurnReplay(event, input, options));
    await assert.rejects(getCoordinatorThread(event, options));
    await assert.rejects(commitCoordinatorTurn(event, followup, "Revoked retry", null, options));
    assert.equal((await db.db.select().from(pollDrafts).where(eq(pollDrafts.id, draft.id)))[0].data.title, next.title);
  } finally {
    await db.db.delete(commons).where(inArray(commons.id, [event, otherEvent]));
    await db.db.delete(people).where(inArray(people.id, [org, coorg, member]));
    await db.close();
  }
});

test("workspace proposals require owner approval and cannot overwrite a newer or published draft", { skip: process.env.COMMONS_RUN_DATABASE_TESTS !== "1" }, async () => {
  const url = process.env.TEST_DATABASE_URL!;
  assert.equal(new URL(url).hostname, "127.0.0.1");
  const db = createDatabase(url), event = randomUUID(), owner = randomUUID(), other = randomUUID();
  const options = { databaseUrl: url, actorPersonId: owner };
  try {
    await db.db.insert(people).values([owner, other].map(id => ({ id, displayName: "Workspace QA", authUserId: id })));
    await db.db.insert(commons).values({ id: event, slug: event, name: "Workspace QA", timezone: "America/Denver", createdByPersonId: owner });
    await db.db.insert(memberships).values([owner, other].map(personId => ({ commonsId: event, personId, role: "organizer" as const, status: "active" as const })));
    const draft = await saveCommonsPollDraft(event, { id: randomUUID(), commandId: randomUUID(), expectedVersion: 0, data: { title: "Hotel", intro: null, ballotMode: "transparent", communication: { heading: "Choose", paragraphs: ["Not booked"], links: [] }, questions: [{ id: randomUUID(), kind: "choice", selectionMode: "single", prompt: "Where?", options: [{ id: randomUUID(), label: "Inn" }, { id: randomUUID(), label: "House" }] }] } }, options);
    const next = { ...draft.data, title: "Choose our base" };
    const input = { commandId: randomUUID(), version: 0, prompt: "Change the title", draftId: draft.id, draftVersion: 1 };
    await commitCoordinatorTurn(event, input, "Proposed", next, options, { proposal: { baseVersion: 1, data: next, changes: ["poll title"], state: "pending" } });
    let thread = await getCoordinatorThread(event, options);
    assert.equal(thread.drafts[0].version, 1); assert.equal(thread.drafts[0].data.title, "Hotel");
    const action = { turnId: thread.turns[0].id, commandId: randomUUID(), action: "apply" };
    await assert.rejects(actOnCoordinatorWorkspace(event, action, { ...options, actorPersonId: other }));
    await actOnCoordinatorWorkspace(event, action, options);
    await actOnCoordinatorWorkspace(event, action, options);
    thread = await getCoordinatorThread(event, options);
    assert.equal(thread.drafts[0].version, 2); assert.equal(thread.drafts[0].data.title, next.title);
    assert.equal(thread.turns[0].workspace?.proposal?.state, "applied");
    await commitCoordinatorTurn(event, { ...input, commandId: randomUUID(), version: 1, draftVersion: 2 }, "Another proposal", next, options, { proposal: { baseVersion: 2, data: next, changes: ["poll title"], state: "pending" } });
    thread = await getCoordinatorThread(event, options);
    const staleAction = { turnId: thread.turns[1].id, commandId: randomUUID(), action: "apply" };
    await saveCommonsPollDraft(event, { id: draft.id, commandId: randomUUID(), expectedVersion: 2, data: { ...next, title: "Human edit" } }, options);
    await assert.rejects(actOnCoordinatorWorkspace(event, staleAction, options));
    assert.equal((await getCoordinatorThread(event, options)).drafts[0].data.title, "Human edit");
    await actOnCoordinatorWorkspace(event, { ...staleAction, action: "dismiss" }, options);
    assert.equal((await getCoordinatorThread(event, options)).turns[1].workspace?.proposal?.state, "dismissed");
    await actOnCoordinatorWorkspace(event, { ...action, action: "save" }, options);
    assert.equal((await getCoordinatorThread(event, options)).turns[0].workspace?.saved, true);
    const latest = (await getCoordinatorThread(event, options)).drafts[0];
    await commitCoordinatorTurn(event, { ...input, commandId: randomUUID(), version: 2, draftVersion: latest.version }, "Before publication", latest.data, options, { proposal: { baseVersion: latest.version, data: latest.data, changes: ["poll title"], state: "pending" } });
    const pendingTurn = (await getCoordinatorThread(event, options)).turns[2];
    await createCommonsPoll(event, { ...latest.data, commandId: randomUUID(), draftId: latest.id, draftVersion: latest.version, shareApproval: { approved: true } }, options);
    await assert.rejects(actOnCoordinatorWorkspace(event, { turnId: pendingTurn.id, commandId: randomUUID(), action: "apply" }, options));
  } finally {
    await db.db.delete(commons).where(eq(commons.id, event));
    await db.db.delete(people).where(inArray(people.id, [owner, other]));
    await db.close();
  }
});
