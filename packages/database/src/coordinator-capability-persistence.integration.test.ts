import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { TurnCommand } from "@commons/contracts";
import { createDatabase } from "./client";
import { commons, coordinatorThreadIdeas, coordinatorThreads, coordinatorTurns, itineraryItems, memberships, people, pollDrafts } from "./schema";
import { beginCoordinatorTurn, completeCoordinatorTurn } from "./coordinator-turn-repository";
import { readThreadExcerpt } from "./coordinator-context-repository";
import { readThreadMeta } from "./coordinator-turn-lifecycle";
import { CoordinatorTurnError } from "./coordinator-errors";

// Stage 4 persistence: what completing a turn may create (a draft in its thread, a separate thread, an idea link),
// all inside the completing transaction so a failed or stale turn leaves nothing behind; and the bounded, authorized
// read of another thread. Synthetic fixtures, disposable local database.
const skip = process.env.COMMONS_RUN_DATABASE_TESTS !== "1";

async function withTrip(run: (context: Awaited<ReturnType<typeof seed>>) => Promise<void>) {
  const context = await seed();
  try { await run(context); } finally { await context.cleanup(); }
}

async function seed() {
  const url = process.env.TEST_DATABASE_URL!;
  assert.equal(new URL(url).hostname, "127.0.0.1");
  const db = createDatabase(url);
  const eventId = randomUUID(), elsewhere = randomUUID(), owner = randomUUID(), traveler = randomUUID();
  await db.db.insert(people).values([{ id: owner, displayName: "Casey Synthetic", authUserId: owner }, { id: traveler, displayName: "Taylor Synthetic", authUserId: traveler }]);
  await db.db.insert(commons).values([eventId, elsewhere].map(id => ({ id, slug: `p-${id}`, name: "Synthetic trip", timezone: "America/Denver", startsOn: "2027-02-12", endsOn: "2027-02-15", locationName: "Breckenridge, Colorado", createdByPersonId: owner })));
  await db.db.insert(memberships).values([
    { commonsId: eventId, personId: owner, role: "organizer", status: "active" }, { commonsId: eventId, personId: traveler, role: "member", status: "active" },
    { commonsId: elsewhere, personId: owner, role: "organizer", status: "active" },
  ]);
  const options = (actorPersonId: string) => ({ databaseUrl: url, sharedCoordinator: true, actorPersonId, provisionalTitle: "Dinner Saturday" });
  const command = (over: Partial<TurnCommand> = {}): TurnCommand => ({ commandId: randomUUID(), target: { kind: "new", threadId: randomUUID() }, inputMode: "text", text: "Where should we eat on Saturday?", ...over } as TurnCommand);
  return {
    url, db, eventId, elsewhere, owner, traveler, options, command,
    started: async (over: Partial<TurnCommand> = {}) => { const cmd = command(over); const { turn } = await beginCoordinatorTurn(eventId, cmd, options(owner)); return { cmd, turn }; },
    counts: async () => ({
      threads: (await db.db.select().from(coordinatorThreads).where(eq(coordinatorThreads.commonsId, eventId))).length,
      drafts: (await db.db.select().from(pollDrafts).where(eq(pollDrafts.commonsId, eventId))).length,
      links: (await db.db.select().from(coordinatorThreadIdeas)).length,
    }),
    cleanup: async () => {
      await db.db.delete(commons).where(inArray(commons.id, [eventId, elsewhere]));
      await db.db.delete(people).where(inArray(people.id, [owner, traveler]));
      await db.close();
    },
  };
}

const outcome = (over: Record<string, unknown> = {}) => ({ status: "completed" as const, assistantText: "Done.", spokenReply: "Done.", sources: [], ...over });
const starter = () => ({ title: "New group question", intro: null, ballotMode: "transparent" as const, questions: [], presentationVersion: 2,
  communication: { heading: "New group question", paragraphs: ["Where should we eat?"], links: [] } });
const proposal = (baseVersion: number) => ({ baseVersion, state: "pending" as const, changes: ["question added"], data: { ...starter(), questions: [{ id: randomUUID(), kind: "choice" as const, selectionMode: "single" as const, prompt: "Where?", required: true,
  options: [{ id: randomUUID(), label: "Inn", exclusive: false }, { id: randomUUID(), label: "House", exclusive: false }] }] } });

test("a new draft is created inside the completing transaction, in the turn's thread, and the proposal is based on its first version", { skip }, () => withTrip(async t => {
  const { cmd, turn } = await t.started();
  const draftId = randomUUID();
  const done = await completeCoordinatorTurn(t.eventId, { turnId: turn.turnId, commandId: cmd.commandId, attempt: turn.attempt, outcome: outcome({ newDraft: { id: draftId, data: starter() }, workspace: { proposal: proposal(1) } }) }, t.options(t.owner));
  assert.equal(done.status, "completed");
  assert.equal(done.draftId, draftId);
  const [draft] = await t.db.db.select().from(pollDrafts).where(eq(pollDrafts.id, draftId));
  assert.deepEqual([draft.threadId, draft.organizerShared, draft.version, draft.publishedPollId, draft.data.questions.length], [turn.threadId, true, 1, null, 0], "private organizer draft; the proposal is not applied");
  assert.equal(done.workspace?.proposal?.state, "pending");
}));

test("a stale proposal or a lost membership saves no draft, thread, or link", { skip }, () => withTrip(async t => {
  const stale = await t.started();
  const failed = await completeCoordinatorTurn(t.eventId, { turnId: stale.turn.turnId, commandId: stale.cmd.commandId, attempt: 1, outcome: outcome({ newDraft: { id: randomUUID(), data: starter() }, workspace: { proposal: proposal(7) } }) }, t.options(t.owner));
  assert.deepEqual([failed.status, failed.errorCode], ["failed", "stale_version"]);
  assert.equal((await t.counts()).drafts, 0, "the draft is rolled back with the failed completion");

  const idea = randomUUID();
  await t.db.db.insert(itineraryItems).values({ id: idea, commonsId: t.eventId, title: "Ski lesson", timezone: "America/Denver", audience: "everyone", status: "idea", provenanceLabel: "Suggested by Casey" });
  const lost = await t.started();
  await t.db.db.update(memberships).set({ status: "left" }).where(and(eq(memberships.commonsId, t.eventId), eq(memberships.personId, t.owner)));
  const lostDone = await completeCoordinatorTurn(t.eventId, { turnId: lost.turn.turnId, commandId: lost.cmd.commandId, attempt: 1, outcome: outcome({ createThread: { id: randomUUID(), title: "Ski", commandId: randomUUID() }, linkIdea: { itineraryItemId: idea } }) }, t.options(t.owner));
  assert.deepEqual([lostDone.status, lostDone.errorCode], ["failed", "membership_lost"]);
  await t.db.db.update(memberships).set({ status: "active" }).where(and(eq(memberships.commonsId, t.eventId), eq(memberships.personId, t.owner)));
  const counts = await t.counts();
  assert.deepEqual([counts.threads, counts.links], [2, 0], "only the two origin threads exist; nothing else was created");
}));

test("start-separate-thread creates one provisional thread with the receipt turn and moves nothing", { skip }, () => withTrip(async t => {
  const { cmd, turn } = await t.started();
  const created = { id: randomUUID(), title: "ski lessons", commandId: randomUUID() };
  const done = await completeCoordinatorTurn(t.eventId, { turnId: turn.turnId, commandId: cmd.commandId, attempt: 1, outcome: outcome({ createThread: created }) }, t.options(t.owner));
  assert.deepEqual(done.workspace?.navigation, { kind: "created", threadId: created.id, title: "ski lessons" });
  const [row] = await t.db.db.select().from(coordinatorThreads).where(eq(coordinatorThreads.id, created.id));
  const meta = (await readThreadMeta(t.db.db as never, t.eventId, [row])).get(row.id)!;
  assert.deepEqual([row.title, meta.titleSource, row.status, row.commonsId, row.createdByPersonId], ["ski lessons", "provisional", "active", t.eventId, t.owner]);
  assert.equal((await t.db.db.select().from(coordinatorTurns).where(eq(coordinatorTurns.threadId, created.id))).length, 0);
  // Completing again (a duplicate delivery) is a no-op, not a second thread.
  await completeCoordinatorTurn(t.eventId, { turnId: turn.turnId, commandId: cmd.commandId, attempt: 1, outcome: outcome({ createThread: { ...created, id: randomUUID(), commandId: randomUUID() } }) }, t.options(t.owner));
  assert.equal((await t.counts()).threads, 2);
}));

test("linking an idea is by reference, checked against this trip, never duplicated, and moves the thread metadata version", { skip }, () => withTrip(async t => {
  const idea = randomUUID(), foreign = randomUUID();
  await t.db.db.insert(itineraryItems).values([{ id: idea, commonsId: t.eventId, title: "Ski lesson", timezone: "America/Denver", audience: "everyone", status: "idea", provenanceLabel: "Suggested by Casey" },
    { id: foreign, commonsId: t.elsewhere, title: "Other trip idea", timezone: "America/Denver", audience: "everyone", status: "idea", provenanceLabel: "Suggested by Casey" }]);
  const wrong = await t.started();
  const rejected = await completeCoordinatorTurn(t.eventId, { turnId: wrong.turn.turnId, commandId: wrong.cmd.commandId, attempt: 1, outcome: outcome({ linkIdea: { itineraryItemId: foreign } }) }, t.options(t.owner));
  assert.deepEqual([rejected.status, rejected.errorCode], ["failed", "artifact_missing"]);
  assert.equal((await t.counts()).links, 0);

  const first = await t.started();
  const versionBefore = first.turn.thread.metadataVersion;
  const linked = await completeCoordinatorTurn(t.eventId, { turnId: first.turn.turnId, commandId: first.cmd.commandId, attempt: 1, outcome: outcome({ linkIdea: { itineraryItemId: idea } }) }, t.options(t.owner));
  assert.equal(linked.workspace?.linkedIdea?.itineraryItemId, idea);
  assert.equal(linked.thread.metadataVersion, versionBefore + 1);
  assert.equal((await t.db.db.select().from(itineraryItems).where(eq(itineraryItems.commonsId, t.eventId))).length, 1, "the idea was linked, not copied");

  const next = await t.started({ target: { kind: "existing", threadId: first.turn.threadId, expectedTurnVersion: 1 } });
  const again = await completeCoordinatorTurn(t.eventId, { turnId: next.turn.turnId, commandId: next.cmd.commandId, attempt: 1, outcome: outcome({ linkIdea: { itineraryItemId: idea } }) }, t.options(t.owner));
  assert.match(String(again.assistantText), /already linked/);
  assert.equal(again.workspace?.linkedIdea, undefined);
  assert.equal((await t.counts()).links, 1);
}));

test("readThreadExcerpt is bounded to the latest shared, completed turns of a thread in this trip and to active organizers", { skip }, () => withTrip(async t => {
  const first = await t.started();
  const threadId = first.turn.threadId;
  await completeCoordinatorTurn(t.eventId, { turnId: first.turn.turnId, commandId: first.cmd.commandId, attempt: 1, outcome: outcome({ assistantText: "A".repeat(900) }) }, t.options(t.owner));
  for (let sequence = 2; sequence <= 10; sequence += 1) {
    const next = await t.started({ text: `Question ${sequence} ${"q".repeat(700)}`, target: { kind: "existing", threadId, expectedTurnVersion: sequence - 1 } });
    await completeCoordinatorTurn(t.eventId, { turnId: next.turn.turnId, commandId: next.cmd.commandId, attempt: 1, outcome: outcome({ assistantText: `Answer ${sequence} ${"a".repeat(900)}` }) }, t.options(t.owner));
  }
  await t.db.db.insert(coordinatorTurns).values({ commonsId: t.eventId, ownerPersonId: t.owner, threadId, organizerShared: false, sequence: 99, commandId: randomUUID(), fingerprint: "x", userText: "PRIVATE-MARKER", assistantText: "PRIVATE-MARKER" });
  const excerpt = await readThreadExcerpt(t.eventId, threadId, t.options(t.owner));
  assert.ok(excerpt.turns.length <= 6, "at most six turns");
  const total = excerpt.turns.reduce((sum, turn) => sum + turn.userText.length + turn.assistantText.length, 0);
  assert.ok(total <= 2_400, `bounded to 2400 characters, got ${total}`);
  assert.match(excerpt.turns.at(-1)!.userText, /^Question 10/, "the most recent discussion survives truncation");
  assert.equal(JSON.stringify(excerpt).includes("PRIVATE-MARKER"), false);
  const rejects = (promise: Promise<unknown>, code: string) => assert.rejects(promise, (error: unknown) => error instanceof CoordinatorTurnError && error.code === code);
  await rejects(readThreadExcerpt(t.eventId, threadId, t.options(t.traveler)), "organizer_required");
  await rejects(readThreadExcerpt(t.elsewhere, threadId, t.options(t.owner)), "thread_unavailable");
  await rejects(readThreadExcerpt(t.eventId, randomUUID(), t.options(t.owner)), "thread_unavailable");
}));
