import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { COORDINATOR_FAILED_TURN_TEXT, COORDINATOR_PENDING_TURN_TEXT, CoordinatorWorkspaceSchema, type TurnCommand } from "@commons/contracts";
import { lifecycleOf, publicWorkspace, readThreadMeta } from "./coordinator-turn-lifecycle";
import { createDatabase } from "./client";
import { commons, coordinatorThreads, coordinatorTurns, expenses, itineraryItems, memberships, people, pollDrafts, processedCommands, stayParticipants, stays, travelPlans, travelerProfiles } from "./schema";
import { turnExecutionHooks, beginCoordinatorTurn, completeCoordinatorTurn, coordinatorTurnAttemptIsLive, failCoordinatorTurn, findCoordinatorTurnByCommand, interruptCoordinatorTurn, listPendingCoordinatorTurns, stopCoordinatorTurn } from "./coordinator-turn-repository";
import { CoordinatorTurnError } from "./coordinator-errors";
import { claimCoordinatorTurnExecution, markCoordinatorTurnProviderStarted, recordCoordinatorTurnProgress, renewCoordinatorTurnExecution } from "./coordinator-turn-execution-repository";
import { coordinatorTurnExecutions } from "./schema";
import { loadCoordinatorTripContext } from "./coordinator-context-repository";
import { saveCommonsPollDraft } from "./poll-draft-repository";
import { actOnCoordinatorWorkspace, commitCoordinatorTurn, getCoordinatorThread, updateCoordinatorThread } from "./coordinator-repository";

const skip = process.env.COMMONS_RUN_DATABASE_TESTS !== "1";

async function withTrip(run: (context: Awaited<ReturnType<typeof seed>>) => Promise<void>) {
  const context = await seed();
  try { await run(context); } finally { await context.cleanup(); }
}

async function seed() {
  const url = process.env.TEST_DATABASE_URL!;
  assert.equal(new URL(url).hostname, "127.0.0.1");
  const db = createDatabase(url);
  const eventId = randomUUID(), elsewhere = randomUUID(), owner = randomUUID(), coOwner = randomUUID(), traveler = randomUUID(), removed = randomUUID(), stayId = randomUUID();
  const ids = [owner, coOwner, traveler, removed];
  await db.db.insert(people).values([
    { id: owner, displayName: "Casey Synthetic", authUserId: owner }, { id: coOwner, displayName: "Robin Synthetic", authUserId: coOwner },
    { id: traveler, displayName: "Taylor Synthetic", authUserId: traveler }, { id: removed, displayName: "Former Synthetic", authUserId: removed },
  ]);
  await db.db.insert(commons).values([eventId, elsewhere].map(id => ({ id, slug: `t-${id}`, name: id === eventId ? "Synthetic Breckenridge weekend" : "Elsewhere", timezone: "America/Denver",
    startsOn: "2027-02-12", endsOn: "2027-02-15", locationName: "Breckenridge, Colorado", createdByPersonId: owner })));
  await db.db.insert(memberships).values([
    { commonsId: eventId, personId: owner, role: "organizer", status: "active" }, { commonsId: eventId, personId: coOwner, role: "organizer", status: "active" },
    { commonsId: eventId, personId: traveler, role: "member", status: "active" }, { commonsId: eventId, personId: removed, role: "organizer", status: "removed" },
    { commonsId: elsewhere, personId: owner, role: "organizer", status: "active" },
  ]);
  await db.db.insert(stays).values({ id: stayId, commonsId: eventId, createdByPersonId: owner, name: "Synthetic Peak Lodge", address: "100 Synthetic Ridge Rd, Breckenridge, CO",
    startsOn: "2027-02-12", endsOn: "2027-02-15", status: "confirmed", totalCents: 184_000, costSource: "confirmation", sourceLabel: "Added by Casey Synthetic",
    confirmationCode: "MARKER-CONFIRMATION-7781", bookingUrl: "https://example.test/marker-booking-7781", details: "MARKER-STAY-DETAILS-7781" });
  await db.db.insert(stayParticipants).values([owner, coOwner, traveler].map(personId => ({ stayId, personId })));
  const base = { databaseUrl: url, sharedCoordinator: true };
  const options = (actorPersonId: string, extra: Record<string, unknown> = {}) => ({ ...base, actorPersonId, provisionalTitle: "Dinner Saturday", ...extra });
  return {
    url, db, eventId, elsewhere, owner, coOwner, traveler, removed, stayId, options,
    command: (over: Partial<TurnCommand> = {}): TurnCommand => ({ commandId: randomUUID(), target: { kind: "new", threadId: randomUUID() }, inputMode: "text", text: "Where should we eat on Saturday?", ...over } as TurnCommand),
    count: async (table: typeof coordinatorTurns | typeof coordinatorThreads | typeof pollDrafts, column: "commonsId") => (await db.db.select().from(table).where(eq(table[column], eventId))).length,
    reservations: async () => (await db.db.select().from(processedCommands).where(eq(processedCommands.commonsId, eventId))).filter(row => (row.result as { kind?: string }).kind === "poll_inference").length,
    cleanup: async () => {
      await db.db.delete(commons).where(inArray(commons.id, [eventId, elsewhere]));
      await db.db.delete(people).where(inArray(people.id, ids));
      await db.close();
    },
  };
}

const outcome = (over: Record<string, unknown> = {}) => ({ status: "completed" as const, assistantText: "Try the early seating near the lodge.", spokenReply: "Try the early seating.", sources: [], ...over });
const draftData = () => ({ title: "Stay", intro: null, ballotMode: "transparent" as const, communication: { heading: "Choose our base", paragraphs: ["Not booked."], links: [] },
  questions: [{ id: randomUUID(), kind: "choice" as const, selectionMode: "single" as const, prompt: "Where?", options: [{ id: randomUUID(), label: "Inn" }, { id: randomUUID(), label: "House" }] }] });
async function rejectsWith(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) => error instanceof CoordinatorTurnError && error.code === code, `expected ${code}`);
}

test("first turn creates one thread and one pending human turn atomically", { skip }, () => withTrip(async t => {
  const command = t.command();
  const { kind, turn } = await beginCoordinatorTurn(t.eventId, command, t.options(t.owner));
  assert.equal(kind, "started");
  assert.equal(turn.status, "pending");
  assert.equal(turn.sequence, 1);
  assert.equal(turn.thread.id, command.target.threadId);
  assert.deepEqual({ title: turn.thread.title, source: turn.thread.titleSource, turnVersion: turn.thread.turnVersion }, { title: "Dinner Saturday", source: "provisional", turnVersion: 1 });
  assert.equal(turn.userText, command.text);
  assert.equal(await t.count(coordinatorThreads, "commonsId"), 1);
  assert.equal(await t.count(coordinatorTurns, "commonsId"), 1);
  assert.equal(await t.count(pollDrafts, "commonsId"), 0, "starting a thread never creates a poll draft");
  assert.equal(await t.reservations(), 1);
}));

test("a rejected first turn leaves no thread, turn, or quota row behind", { skip }, () => withTrip(async t => {
  await rejectsWith(beginCoordinatorTurn(t.eventId, t.command({ target: { kind: "existing", threadId: randomUUID(), expectedTurnVersion: 0 } }), t.options(t.owner)), "thread_unavailable");
  await rejectsWith(beginCoordinatorTurn(t.eventId, t.command({ target: { kind: "new", threadId: randomUUID() }, explicitAction: undefined }), t.options(t.owner, { hourlyInferenceLimit: 0 })), "rate_limited");
  assert.equal(await t.count(coordinatorThreads, "commonsId"), 0, "the thread insert rolled back with the failed reservation");
  assert.equal(await t.count(coordinatorTurns, "commonsId"), 0);
  assert.equal(await t.reservations(), 0);
}));

test("retrying the same command returns the same thread and turn without another inference reservation", { skip }, () => withTrip(async t => {
  const command = t.command();
  const first = await beginCoordinatorTurn(t.eventId, command, t.options(t.owner));
  const again = await beginCoordinatorTurn(t.eventId, command, t.options(t.owner));
  assert.equal(again.kind, "replayed");
  assert.equal(again.turn.turnId, first.turn.turnId);
  assert.equal(await t.count(coordinatorThreads, "commonsId"), 1);
  assert.equal(await t.count(coordinatorTurns, "commonsId"), 1);
  assert.equal(await t.reservations(), 1);
  // A refreshed retry may carry a different expected version and voice metadata and still be the same command.
  const done = await completeCoordinatorTurn(t.eventId, { turnId: first.turn.turnId, commandId: command.commandId, attempt: 1, outcome: outcome() }, t.options(t.owner));
  assert.equal(done.status, "completed");
  const replayCompleted = await beginCoordinatorTurn(t.eventId, command, t.options(t.owner));
  assert.equal(replayCompleted.kind, "replayed");
  assert.equal(replayCompleted.turn.assistantText, "Try the early seating near the lodge.");
  assert.equal(await t.reservations(), 1);
}));

test("concurrent duplicate first-turn commands create one thread and one turn", { skip }, () => withTrip(async t => {
  const command = t.command();
  const results = await Promise.all([1, 2, 3].map(() => beginCoordinatorTurn(t.eventId, command, t.options(t.owner))));
  assert.deepEqual(results.map(result => result.kind).sort(), ["replayed", "replayed", "started"]);
  assert.equal(new Set(results.map(result => result.turn.turnId)).size, 1);
  assert.equal(await t.count(coordinatorThreads, "commonsId"), 1);
  assert.equal(await t.count(coordinatorTurns, "commonsId"), 1);
  assert.equal(await t.reservations(), 1);
}));

test("reusing a command id with different text is command_mismatch", { skip }, () => withTrip(async t => {
  const command = t.command();
  await beginCoordinatorTurn(t.eventId, command, t.options(t.owner));
  await rejectsWith(beginCoordinatorTurn(t.eventId, { ...command, text: "Something else entirely" }, t.options(t.owner)), "command_mismatch");
  await rejectsWith(beginCoordinatorTurn(t.eventId, t.command({ target: command.target }), t.options(t.owner)), "command_mismatch");
  assert.equal(await t.count(coordinatorTurns, "commonsId"), 1);
}));

test("a stale expected version is rejected before any write or quota use", { skip }, () => withTrip(async t => {
  const first = t.command();
  const { turn } = await beginCoordinatorTurn(t.eventId, first, t.options(t.owner));
  await completeCoordinatorTurn(t.eventId, { turnId: turn.turnId, commandId: first.commandId, attempt: 1, outcome: outcome() }, t.options(t.owner));
  const before = await t.reservations();
  await rejectsWith(beginCoordinatorTurn(t.eventId, t.command({ target: { kind: "existing", threadId: turn.threadId, expectedTurnVersion: 0 } }), t.options(t.coOwner)), "stale_version");
  assert.equal(await t.count(coordinatorTurns, "commonsId"), 1);
  assert.equal(await t.reservations(), before);
  const next = await beginCoordinatorTurn(t.eventId, t.command({ target: { kind: "existing", threadId: turn.threadId, expectedTurnVersion: 1 } }), t.options(t.coOwner));
  assert.equal(next.turn.sequence, 2, "another active organizer continues the shared thread");
}));

test("a failed turn stays visible with its error code and a retry reuses the same row", { skip }, () => withTrip(async t => {
  const command = t.command();
  const { turn } = await beginCoordinatorTurn(t.eventId, command, t.options(t.owner));
  const failed = await failCoordinatorTurn(t.eventId, { turnId: turn.turnId, commandId: command.commandId, attempt: 1, errorCode: "provider_failed" }, t.options(t.owner));
  assert.deepEqual({ status: failed.status, code: failed.errorCode, text: failed.userText, answer: failed.assistantText }, { status: "failed", code: "provider_failed", text: command.text, answer: null });
  assert.equal((await findCoordinatorTurnByCommand(t.eventId, command.commandId, t.options(t.owner)))?.status, "failed");
  const retry = await beginCoordinatorTurn(t.eventId, command, t.options(t.owner));
  assert.deepEqual({ kind: retry.kind, id: retry.turn.turnId, attempt: retry.turn.attempt, status: retry.turn.status, code: retry.turn.errorCode }, { kind: "started", id: turn.turnId, attempt: 2, status: "pending", code: null });
  assert.equal(await t.count(coordinatorTurns, "commonsId"), 1);
  assert.equal(await t.count(coordinatorThreads, "commonsId"), 1);
  assert.equal(await t.reservations(), 2, "a genuine retry counts once more");
  // The first attempt cannot overwrite the second, and a late failure of attempt 1 is ignored.
  const late = await failCoordinatorTurn(t.eventId, { turnId: turn.turnId, commandId: command.commandId, attempt: 1, errorCode: "provider_failed" }, t.options(t.owner));
  assert.equal(late.status, "pending");
  const done = await completeCoordinatorTurn(t.eventId, { turnId: turn.turnId, commandId: command.commandId, attempt: 2, outcome: outcome() }, t.options(t.owner));
  assert.equal(done.status, "completed");
  // A non-retryable failure is replayed, not retried.
  const second = t.command();
  const started = await beginCoordinatorTurn(t.eventId, second, t.options(t.owner));
  await failCoordinatorTurn(t.eventId, { turnId: started.turn.turnId, commandId: second.commandId, attempt: 1, errorCode: "unsupported_capability" }, t.options(t.owner));
  assert.equal((await beginCoordinatorTurn(t.eventId, second, t.options(t.owner))).kind, "replayed");
}));

test("retries are bounded", { skip }, () => withTrip(async t => {
  const command = t.command();
  let { turn } = await beginCoordinatorTurn(t.eventId, command, t.options(t.owner));
  for (const attempt of [1, 2, 3]) {
    await failCoordinatorTurn(t.eventId, { turnId: turn.turnId, commandId: command.commandId, attempt, errorCode: "provider_failed" }, t.options(t.owner));
    const retry = await beginCoordinatorTurn(t.eventId, command, t.options(t.owner));
    if (attempt < 3) { assert.equal(retry.kind, "started"); turn = retry.turn; } else assert.equal(retry.kind, "replayed", "the third failure is final");
  }
}));

test("an expired pending lease is reported as failed on lookup and can be retried", { skip }, () => withTrip(async t => {
  const command = t.command();
  const now = new Date();
  const { turn } = await beginCoordinatorTurn(t.eventId, command, { ...t.options(t.owner), now });
  assert.equal((await findCoordinatorTurnByCommand(t.eventId, command.commandId, { ...t.options(t.owner), now: new Date(now.getTime() + 60_000) }))?.status, "pending");
  const late = await findCoordinatorTurnByCommand(t.eventId, command.commandId, { ...t.options(t.owner), now: new Date(now.getTime() + 121_000) });
  assert.deepEqual({ status: late?.status, code: late?.errorCode }, { status: "failed", code: "internal_error" });
  assert.equal(await findCoordinatorTurnByCommand(t.eventId, randomUUID(), t.options(t.owner)), null);
  assert.equal(await findCoordinatorTurnByCommand(t.eventId, command.commandId, t.options(t.coOwner)), null, "another organizer cannot read this author's command");
  const retry = await beginCoordinatorTurn(t.eventId, command, { ...t.options(t.owner), now: new Date(now.getTime() + 130_000) });
  assert.deepEqual({ kind: retry.kind, id: retry.turn.turnId }, { kind: "started", id: turn.turnId });
}));

for (const mode of ["explicit", "inferred"] as const) test(`slow ${mode} itinerary generation stays pending past two minutes; retries cannot duplicate active work`, { skip }, () => withTrip(async t => {
  const command = { ...t.command(), ...(mode === "explicit" ? { explicitAction: { kind: "itinerary" as const, baseVersion: 0 } } : {}) };
  const options = { ...t.options(t.owner), itineraryGeneration: mode === "inferred" };
  const now = new Date();
  const { turn } = await beginCoordinatorTurn(t.eventId, command, { ...options, now });
  const during = new Date(now.getTime() + 170_000);
  assert.equal((await findCoordinatorTurnByCommand(t.eventId, command.commandId, { ...t.options(t.owner), now: during }))?.status, "pending");
  const replay = await beginCoordinatorTurn(t.eventId, command, { ...options, now: during });
  assert.equal(replay.kind, "replayed");
  assert.equal(replay.turn.attempt, 1);
  assert.equal(await t.reservations(), 1);
  const expired = new Date(now.getTime() + 241_000);
  assert.equal((await findCoordinatorTurnByCommand(t.eventId, command.commandId, { ...t.options(t.owner), now: expired }))?.status, "failed");
  const retry = await beginCoordinatorTurn(t.eventId, command, { ...options, now: expired });
  assert.equal(retry.kind, "started");
  assert.equal(retry.turn.turnId, turn.turnId);
  assert.equal(retry.turn.attempt, 2);
  const [row] = await t.db.db.select().from(coordinatorTurns).where(eq(coordinatorTurns.id, turn.turnId));
  assert.equal(lifecycleOf(row).leaseExpiresAt, new Date(expired.getTime() + 240_000).toISOString());
}));

test("a draft from another thread is artifact_misassociated and an unthreaded shared draft is adopted", { skip }, () => withTrip(async t => {
  const opts = t.options(t.owner);
  const draft = await saveCommonsPollDraft(t.eventId, { id: randomUUID(), commandId: randomUUID(), expectedVersion: 0, data: draftData() }, opts);
  const first = t.command();
  const adopted = await beginCoordinatorTurn(t.eventId, { ...first, explicitAction: { kind: "ask_group", starterId: null }, artifact: undefined }, opts);
  assert.equal(adopted.turn.draftId, null);
  const fresh = t.command({ target: { kind: "existing", threadId: adopted.turn.threadId, expectedTurnVersion: 1 } });
  // A new-thread command cannot carry an artifact (contract), so use the existing thread to adopt an unthreaded shared draft.
  await completeCoordinatorTurn(t.eventId, { turnId: adopted.turn.turnId, commandId: first.commandId, attempt: 1, outcome: outcome() }, opts);
  const withDraft = await beginCoordinatorTurn(t.eventId, { ...fresh, artifact: { kind: "draft", id: draft.id, version: draft.version } }, opts);
  assert.equal(withDraft.turn.draftId, draft.id);
  const [saved] = await t.db.db.select().from(pollDrafts).where(eq(pollDrafts.id, draft.id));
  assert.equal(saved.threadId, adopted.turn.threadId, "adopted in the same transaction");
  // Another thread cannot claim it.
  const other = await beginCoordinatorTurn(t.eventId, t.command(), opts);
  await completeCoordinatorTurn(t.eventId, { turnId: other.turn.turnId, commandId: other.turn.commandId, attempt: 1, outcome: outcome() }, opts);
  await rejectsWith(beginCoordinatorTurn(t.eventId, t.command({ target: { kind: "existing", threadId: other.turn.threadId, expectedTurnVersion: 1 }, artifact: { kind: "draft", id: draft.id, version: draft.version } }), opts), "artifact_misassociated");
  await rejectsWith(beginCoordinatorTurn(t.eventId, t.command({ target: { kind: "existing", threadId: other.turn.threadId, expectedTurnVersion: 1 }, artifact: { kind: "draft", id: randomUUID(), version: 1 } }), opts), "artifact_missing");
  await rejectsWith(beginCoordinatorTurn(t.eventId, t.command({ target: { kind: "existing", threadId: adopted.turn.threadId, expectedTurnVersion: 2 }, artifact: { kind: "draft", id: draft.id, version: draft.version + 5 } }), opts), "stale_version");
  // Legacy owner-private drafts are indistinguishable from missing ones.
  const legacy = await saveCommonsPollDraft(t.eventId, { id: randomUUID(), commandId: randomUUID(), expectedVersion: 0, data: draftData() }, { ...opts, sharedCoordinator: false });
  await rejectsWith(beginCoordinatorTurn(t.eventId, t.command({ target: { kind: "existing", threadId: adopted.turn.threadId, expectedTurnVersion: 2 }, artifact: { kind: "draft", id: legacy.id, version: legacy.version } }), opts), "artifact_missing");
  assert.equal(await t.count(coordinatorTurns, "commonsId"), 3, "no rejected command saved a turn");
}));

test("participant, removed organizer, other-trip thread, and archived thread get distinct codes", { skip }, () => withTrip(async t => {
  const started = await beginCoordinatorTurn(t.eventId, t.command(), t.options(t.owner));
  await completeCoordinatorTurn(t.eventId, { turnId: started.turn.turnId, commandId: started.turn.commandId, attempt: 1, outcome: outcome() }, t.options(t.owner));
  const existing = (over: Partial<TurnCommand> = {}) => t.command({ target: { kind: "existing", threadId: started.turn.threadId, expectedTurnVersion: 1 }, ...over });
  await rejectsWith(beginCoordinatorTurn(t.eventId, existing(), t.options(t.traveler)), "organizer_required");
  await rejectsWith(beginCoordinatorTurn(t.eventId, existing(), t.options(t.removed)), "membership_lost");
  await rejectsWith(beginCoordinatorTurn(t.eventId, existing(), t.options(randomUUID())), "membership_lost");
  await rejectsWith(beginCoordinatorTurn(randomUUID(), existing(), t.options(t.owner)), "membership_lost");
  await rejectsWith(findCoordinatorTurnByCommand(t.eventId, started.turn.commandId, t.options(t.traveler)), "organizer_required");
  // The owner is an organizer of another trip, but this thread lives in the first trip.
  await rejectsWith(beginCoordinatorTurn(t.elsewhere, existing(), t.options(t.owner)), "thread_unavailable");
  await updateCoordinatorThread(t.eventId, { threadId: started.turn.threadId, commandId: randomUUID(), expectedVersion: 1, status: "archived" }, t.options(t.owner));
  await rejectsWith(beginCoordinatorTurn(t.eventId, existing(), t.options(t.owner)), "thread_archived");
  assert.equal(await t.count(coordinatorTurns, "commonsId"), 1);
}));

test("completion after membership loss saves no answer", { skip }, () => withTrip(async t => {
  const command = t.command();
  const started = await beginCoordinatorTurn(t.eventId, command, t.options(t.coOwner));
  await t.db.db.update(memberships).set({ status: "removed" }).where(and(eq(memberships.commonsId, t.eventId), eq(memberships.personId, t.coOwner)));
  const done = await completeCoordinatorTurn(t.eventId, { turnId: started.turn.turnId, commandId: command.commandId, attempt: 1, outcome: outcome({ assistantText: "MARKER-ANSWER-NOT-SAVED" }) }, t.options(t.coOwner));
  assert.deepEqual({ status: done.status, code: done.errorCode, answer: done.assistantText }, { status: "failed", code: "membership_lost", answer: null });
  const [row] = await t.db.db.select().from(coordinatorTurns).where(eq(coordinatorTurns.id, started.turn.turnId));
  assert.equal(row.assistantText, COORDINATOR_FAILED_TURN_TEXT, "a failed row holds the neutral placeholder, never an answer or an empty string");
  assert.equal(lifecycleOf(row).spokenReply, null);
}));

test("completion is refused when the facts a trip proposal was built from moved (stale_version), and nothing is overwritten", { skip }, () => withTrip(async t => {
  const command = t.command();
  const started = await beginCoordinatorTurn(t.eventId, command, t.options(t.owner));
  const [stay] = await t.db.db.select().from(stays).where(eq(stays.id, t.stayId));
  const proposal = { version: 1, state: "pending" as const, source: "Update the stay cost to $2,000", operations: ["stay" as const], travelers: [], receipt: null,
    base: { budgetCents: null, startsOn: null, endsOn: null, locationName: null, stay: { id: stay.id, name: stay.name, address: stay.address, startsOn: stay.startsOn, endsOn: stay.endsOn, status: stay.status, totalCents: stay.totalCents, currency: "USD" as const, bookingUrl: null, updatedAt: stay.updatedAt.toISOString() }, includedPersonIds: [] },
    changes: { budgetCents: null, startsOn: null, endsOn: null, locationName: null, stay: { id: stay.id, name: stay.name, address: stay.address, startsOn: stay.startsOn, endsOn: stay.endsOn, status: stay.status, totalCents: 200_000, currency: "USD" as const, bookingUrl: null, updatedAt: stay.updatedAt.toISOString() }, includedPersonIds: [] } };
  // Another organizer edits the same stay while the model is working.
  await t.db.db.update(stays).set({ totalCents: 190_000, updatedAt: new Date(Date.now() + 5000) }).where(eq(stays.id, t.stayId));
  const done = await completeCoordinatorTurn(t.eventId, { turnId: started.turn.turnId, commandId: command.commandId, attempt: 1, outcome: outcome({ workspace: { tripConversation: true, tripProposal: proposal } }) }, t.options(t.owner));
  assert.deepEqual({ status: done.status, code: done.errorCode, workspace: done.workspace }, { status: "failed", code: "stale_version", workspace: null });
  const [after] = await t.db.db.select().from(stays).where(eq(stays.id, t.stayId));
  assert.equal(after.totalCents, 190_000, "the other organizer's change stands");
}));

test("hourly limit returns rate_limited without saving a thread or turn", { skip }, () => withTrip(async t => {
  for (let index = 0; index < 3; index += 1) await beginCoordinatorTurn(t.eventId, t.command(), t.options(t.owner, { hourlyInferenceLimit: 3 }));
  const before = await t.count(coordinatorThreads, "commonsId");
  await rejectsWith(beginCoordinatorTurn(t.eventId, t.command(), t.options(t.owner, { hourlyInferenceLimit: 3 })), "rate_limited");
  assert.equal(await t.count(coordinatorThreads, "commonsId"), before);
  assert.equal(await t.reservations(), 3);
}));

test("provisional titles are bounded and generated titles never replace organizer titles", { skip }, () => withTrip(async t => {
  const long = t.command({ text: "Where should the whole family eat dinner on Saturday night when we get in from Denver around five?" });
  const started = await beginCoordinatorTurn(t.eventId, long, t.options(t.owner, { provisionalTitle: "Where should the whole family eat dinner on Saturday night when we get in from Denver" }));
  const done = await completeCoordinatorTurn(t.eventId, { turnId: started.turn.turnId, commandId: long.commandId, attempt: 1,
    outcome: outcome({ threadUpdate: { topicTitle: "Saturday dinner near the lodge, ideally family friendly and quick for the kids after a long drive", summary: "Deciding where to eat." } }) }, t.options(t.owner));
  assert.ok(done.thread.title.length <= 60, done.thread.title);
  assert.equal(done.thread.titleSource, "generated");
  assert.equal(done.thread.metadataVersion, 2);
  // A second generated title does not replace the first.
  const second = t.command({ target: { kind: "existing", threadId: done.threadId, expectedTurnVersion: 1 } });
  const next = await beginCoordinatorTurn(t.eventId, second, t.options(t.owner));
  const kept = await completeCoordinatorTurn(t.eventId, { turnId: next.turn.turnId, commandId: second.commandId, attempt: 1, outcome: outcome({ threadUpdate: { topicTitle: "Different heading" } }) }, t.options(t.owner));
  assert.equal(kept.thread.title, done.thread.title);
  // Organizer-set titles are never overwritten.
  const organizerThread = await beginCoordinatorTurn(t.eventId, t.command(), t.options(t.owner));
  await t.db.db.update(coordinatorThreads).set({ title: "Our dinner plan" }).where(eq(coordinatorThreads.id, organizerThread.turn.threadId));
  const renamed = await completeCoordinatorTurn(t.eventId, { turnId: organizerThread.turn.turnId, commandId: organizerThread.turn.commandId, attempt: 1, outcome: outcome({ threadUpdate: { topicTitle: "Generated heading" } }) }, t.options(t.owner));
  assert.deepEqual({ title: renamed.thread.title, source: renamed.thread.titleSource }, { title: "Our dinner plan", source: "organizer" });
}));

test("legacy attendance statement is recorded in the completing transaction with an undoable receipt", { skip }, () => withTrip(async t => {
  const command = t.command({ text: "I am attending the trip." });
  const started = await beginCoordinatorTurn(t.eventId, command, t.options(t.owner));
  const done = await completeCoordinatorTurn(t.eventId, { turnId: started.turn.turnId, commandId: command.commandId, attempt: 1,
    outcome: outcome({ assistantText: "Recording attendance.", spokenReply: "Recording attendance.", attendanceStatement: true, workspace: { tripConversation: true } }) }, t.options(t.owner));
  assert.match(done.assistantText!, /marked as attending/);
  assert.equal(done.workspace?.attendanceReceipt?.people[0].personId, t.owner);
  const [member] = await t.db.db.select().from(memberships).where(and(eq(memberships.commonsId, t.eventId), eq(memberships.personId, t.owner)));
  assert.equal(member.attendanceState, "attending");
  assert.equal(await t.count(pollDrafts, "commonsId"), 0);
}));

test("trip context includes saved stay, dates, destination, travelers and attendance with versions and provenance", { skip }, () => withTrip(async t => {
  await t.db.db.update(memberships).set({ attendanceState: "attending", attendanceDates: "2027-02-12 to 2027-02-15" }).where(and(eq(memberships.commonsId, t.eventId), eq(memberships.personId, t.owner)));
  await t.db.db.update(commons).set({ targetBudgetCents: 500_000 }).where(eq(commons.id, t.eventId));
  const now = new Date();
  const context = await loadCoordinatorTripContext(t.eventId, { ...t.options(t.owner), now, capabilities: ["answer"] });
  assert.equal(context.audience, "active_organizers");
  assert.deepEqual({ dest: context.trip.value.destination, start: context.trip.value.startsOn, end: context.trip.value.endsOn, tz: context.trip.value.timezone }, { dest: "Breckenridge, Colorado", start: "2027-02-12", end: "2027-02-15", tz: "America/Denver" });
  assert.equal(context.trip.provenance.kind, "saved_record");
  assert.equal(context.trip.freshness.asOf, now.toISOString());
  const [stay] = context.stays;
  assert.deepEqual({ name: stay.value.name, address: stay.value.address, status: stay.value.status, reported: stay.value.bookingReportedByOrganizer, verified: stay.value.availabilityVerified, cost: stay.value.costCents, kind: stay.value.costKind, included: stay.value.includedPersonIds.length },
    { name: "Synthetic Peak Lodge", address: "100 Synthetic Ridge Rd, Breckenridge, CO", status: "confirmed", reported: true, verified: false, cost: 184_000, kind: "confirmation", included: 3 });
  assert.equal(stay.provenance.recordId, t.stayId);
  assert.ok(stay.version && stay.freshness.updatedAt);
  const casey = context.travelers.find(item => item.value.personId === t.owner)!;
  assert.deepEqual({ membership: casey.value.membership, attendance: casey.value.attendance, role: casey.value.role }, { membership: "active", attendance: "attending", role: "organizer" });
  assert.equal(context.travelers.some(item => item.value.personId === t.removed), false, "removed members are not travelers");
  assert.equal(context.budget.value.targetTotalCents, 500_000);
  assert.deepEqual(context.unknowns.sort(), ["plans", "travel_logistics"].sort());
  assert.equal(context.capabilities.join(), "answer");
}));

test("trip context excludes legacy private turns, recommendations, traveler profiles, private travel plans and confirmation codes", { skip }, () => withTrip(async t => {
  const markers = { turn: "MARKER-LEGACY-PRIVATE-TURN-5521", draft: "MARKER-LEGACY-PRIVATE-DRAFT-5521", profile: "MARKER-DIETARY-PROFILE-5521", privatePlan: "MARKER-PRIVATE-FLIGHT-ROUTE-5521", code: "MARKER-FLIGHT-CODE-5521", note: "MARKER-ITINERARY-NOTE-5521", email: "marker-5521@example.test" };
  // Legacy owner-private conversation and draft.
  await commitCoordinatorTurn(t.eventId, { commandId: randomUUID(), version: 0, prompt: markers.turn, draftId: null, draftVersion: null }, `Reply ${markers.turn}`, null, { ...t.options(t.owner), sharedCoordinator: false });
  await saveCommonsPollDraft(t.eventId, { id: randomUUID(), commandId: randomUUID(), expectedVersion: 0, data: { ...draftData(), title: markers.draft } }, { ...t.options(t.owner), sharedCoordinator: false });
  // Restricted traveler details.
  await t.db.db.insert(travelerProfiles).values({ personId: t.traveler, dietaryPreferences: markers.profile });
  await t.db.db.insert(travelPlans).values([
    { commonsId: t.eventId, personId: t.traveler, kind: "car_rental", date: "2027-02-12", route: markers.privatePlan, time: "14:30", status: "confirmed", visibility: "private", confirmationCode: markers.code, sourceLabel: "Added by Taylor Synthetic" },
    { commonsId: t.eventId, personId: t.coOwner, kind: "arrival", date: "2027-02-12", route: "Denver to Breckenridge", time: "15:00", status: "booked", visibility: "basic", confirmationCode: markers.code, sourceLabel: "Added by Robin Synthetic" },
  ]);
  await t.db.db.insert(itineraryItems).values({ commonsId: t.eventId, title: "Winery lunch", timezone: "America/Denver", audience: "everyone", status: "idea", note: markers.note, provenanceLabel: "Suggested by Casey", sourceUrl: `https://example.test/${markers.email}` });
  const context = await loadCoordinatorTripContext(t.eventId, { ...t.options(t.owner), capabilities: ["answer"] });
  const serialized = JSON.stringify(context);
  for (const [name, marker] of Object.entries(markers)) assert.equal(serialized.includes(marker), false, `${name} marker must not appear in the snapshot`);
  assert.equal(serialized.includes("MARKER-CONFIRMATION-7781"), false, "stay confirmation code");
  assert.equal(serialized.includes("marker-booking-7781"), false, "stay booking url");
  assert.equal(serialized.includes("MARKER-STAY-DETAILS-7781"), false, "stay details");
  assert.equal(serialized.includes("@example.test"), false);
  assert.equal(context.logistics.length, 1, "only the non-private travel plan is included");
  assert.equal(context.logistics[0].value.arrivesAt, null, "a legacy flight without an endpoint timezone has no invented instant");
  assert.equal(context.logistics[0].value.localTime, "15:00");
  assert.equal(context.plans[0].value.title, "Winery lunch");
  assert.equal(context.threads.length, 0, "legacy unthreaded private turns never appear in the thread index");
  await t.db.db.delete(expenses).where(eq(expenses.commonsId, t.eventId));
}));

test("thread index carries artifact counts and record-derived outcomes only", { skip }, () => withTrip(async t => {
  const first = t.command();
  const started = await beginCoordinatorTurn(t.eventId, first, t.options(t.owner));
  await completeCoordinatorTurn(t.eventId, { turnId: started.turn.turnId, commandId: first.commandId, attempt: 1, outcome: outcome({ threadUpdate: { summary: "Comparing early dinner spots." , openQuestions: ["How many kids?"] } }) }, t.options(t.owner));
  const context = await loadCoordinatorTripContext(t.eventId, { ...t.options(t.coOwner), activeThreadId: started.turn.threadId });
  const [entry] = context.threads;
  assert.deepEqual({ id: entry.threadId, turnVersion: entry.turnVersion, summary: entry.summary, summaryTurnVersion: entry.summaryTurnVersion, questions: entry.openQuestions, outcomes: entry.approvedOutcomes.length },
    { id: started.turn.threadId, turnVersion: 1, summary: "Comparing early dinner spots.", summaryTurnVersion: 1, questions: ["How many kids?"], outcomes: 0 });
  await rejectsWith(loadCoordinatorTripContext(t.eventId, t.options(t.traveler)), "organizer_required");
}));


// ---------------------------------------------------------------------------
// No-migration representation (design §5): lifecycle in workspace.lifecycle, thread state in workspace.threadState.
// ---------------------------------------------------------------------------

test("the schema is exactly migration 0073: no new columns, indexes, or constraints exist on the coordinator tables", { skip }, () => withTrip(async t => {
  const columns = async (table: string) => (await t.db.db.execute(sql`select column_name from information_schema.columns where table_schema = 'public' and table_name = ${table} order by column_name`) as unknown as Array<{ column_name: string }>).map(row => row.column_name);
  assert.deepEqual(await columns("coordinator_turns"), ["assistant_text", "command_id", "commons_id", "context_poll_id", "context_turn_id", "created_at", "draft_id", "fingerprint", "id", "organizer_shared", "owner_person_id", "sequence", "thread_id", "user_text", "workspace"]);
  assert.deepEqual(await columns("coordinator_threads"), ["archived_at", "commons_id", "created_at", "created_by_person_id", "id", "last_command_fingerprint", "last_command_id", "status", "title", "updated_at", "version"]);
  const checks = (await t.db.db.execute(sql`select conname from pg_constraint where contype = 'c' and conrelid in ('coordinator_turns'::regclass, 'coordinator_threads'::regclass) order by conname`) as unknown as Array<{ conname: string }>).map(row => row.conname);
  assert.deepEqual(checks, ["coordinator_threads_positive_version", "coordinator_threads_status_check", "coordinator_turns_positive_sequence"]);
}));

test("a pending row stores its lifecycle in workspace, holds a neutral placeholder answer, and never an empty assistant_text", { skip }, () => withTrip(async t => {
  const command = t.command({ inputMode: "voice", voice: { sessionId: "s-1", delegationId: "d-1" } });
  const now = new Date("2027-01-01T10:00:00.000Z");
  const { turn } = await beginCoordinatorTurn(t.eventId, command, { ...t.options(t.owner), now });
  const [row] = await t.db.db.select().from(coordinatorTurns).where(eq(coordinatorTurns.id, turn.turnId));
  assert.equal(row.assistantText, COORDINATOR_PENDING_TURN_TEXT);
  assert.deepEqual(row.workspace, { lifecycle: { v: 1, status: "pending", inputMode: "voice", errorCode: null, attempt: 1, leaseExpiresAt: "2027-01-01T10:02:00.000Z", spokenReply: null, sources: [], completedAt: null, provisionalTitle: "Dinner Saturday" } });
  assert.equal(turn.assistantText, null, "this code never treats the placeholder as an answer");
  assert.equal(turn.workspace, null, "internal storage keys are not part of the record's workspace");
  const thread = await getCoordinatorThread(t.eventId, t.options(t.owner), undefined, turn.threadId);
  assert.deepEqual(thread.turns.map(item => [item.status, item.inputMode, item.assistantText === COORDINATOR_PENDING_TURN_TEXT]), [["pending", "voice", true]]);
  assert.equal(thread.threads[0].titleSource, "provisional");
  // A failed row is likewise never empty for older readers.
  await failCoordinatorTurn(t.eventId, { turnId: turn.turnId, commandId: command.commandId, attempt: 1, errorCode: "provider_failed" }, t.options(t.owner));
  const failed = await getCoordinatorThread(t.eventId, t.options(t.owner), undefined, turn.threadId);
  assert.deepEqual(failed.turns.map(item => [item.status, item.errorCode, item.assistantText]), [["failed", "provider_failed", COORDINATOR_FAILED_TURN_TEXT]]);
}));

test("rows without a lifecycle are completed text turns (legacy and production main writes)", { skip }, () => withTrip(async t => {
  const started = await beginCoordinatorTurn(t.eventId, t.command(), t.options(t.owner));
  await completeCoordinatorTurn(t.eventId, { turnId: started.turn.turnId, commandId: started.turn.commandId, attempt: 1, outcome: outcome() }, t.options(t.owner));
  // What production main does after a reviewed action: parse the workspace with its own schema (stripping unknown keys) and write it back.
  const [stored] = await t.db.db.select().from(coordinatorTurns).where(eq(coordinatorTurns.id, started.turn.turnId));
  const mainView = { ...stored.workspace! };
  delete mainView.lifecycle; delete mainView.threadState;
  await t.db.db.update(coordinatorTurns).set({ workspace: mainView }).where(eq(coordinatorTurns.id, stored.id));
  const found = await findCoordinatorTurnByCommand(t.eventId, started.turn.commandId, t.options(t.owner));
  assert.deepEqual({ status: found?.status, mode: found?.inputMode, answer: found?.assistantText, attempt: found?.attempt }, { status: "completed", mode: "text", answer: "Try the early seating near the lodge.", attempt: 1 });
  const legacy = await getCoordinatorThread(t.eventId, t.options(t.owner), undefined, started.turn.threadId);
  assert.equal(legacy.turns[0].status, "completed");
}));

test("complete and fail are attempt-guarded: a stale attempt saves nothing and racing completions save exactly one answer", { skip }, () => withTrip(async t => {
  const command = t.command();
  const first = await beginCoordinatorTurn(t.eventId, command, t.options(t.owner));
  await failCoordinatorTurn(t.eventId, { turnId: first.turn.turnId, commandId: command.commandId, attempt: 1, errorCode: "provider_failed" }, t.options(t.owner));
  const second = await beginCoordinatorTurn(t.eventId, command, t.options(t.owner));
  assert.equal(second.turn.attempt, 2);
  const stale = await completeCoordinatorTurn(t.eventId, { turnId: first.turn.turnId, commandId: command.commandId, attempt: 1, outcome: outcome({ assistantText: "STALE-ATTEMPT-ANSWER" }) }, t.options(t.owner));
  assert.deepEqual({ status: stale.status, attempt: stale.attempt, answer: stale.assistantText }, { status: "pending", attempt: 2, answer: null });
  const [rowAfterStale] = await t.db.db.select().from(coordinatorTurns).where(eq(coordinatorTurns.id, first.turn.turnId));
  assert.equal(rowAfterStale.assistantText, COORDINATOR_PENDING_TURN_TEXT);
  // Two completions of the same attempt race under the row lock: one wins, the other reads the winner.
  const results = await Promise.all(["ANSWER-A", "ANSWER-B"].map(assistantText => completeCoordinatorTurn(t.eventId, { turnId: first.turn.turnId, commandId: command.commandId, attempt: 2, outcome: outcome({ assistantText, threadUpdate: { summary: assistantText } }) }, t.options(t.owner))));
  assert.equal(new Set(results.map(result => result.assistantText)).size, 1, "both callers see the single saved answer");
  assert.ok(["ANSWER-A", "ANSWER-B"].includes(results[0].assistantText!));
  const [stored] = await t.db.db.select().from(coordinatorTurns).where(eq(coordinatorTurns.id, first.turn.turnId));
  assert.equal(stored.workspace?.threadState?.summary, results[0].assistantText, "the loser's thread update was not applied");
  // A late failure of the finished attempt is ignored.
  const late = await failCoordinatorTurn(t.eventId, { turnId: first.turn.turnId, commandId: command.commandId, attempt: 2, errorCode: "internal_error" }, t.options(t.owner));
  assert.equal(late.status, "completed");
  assert.equal(await t.count(coordinatorTurns, "commonsId"), 1);
}));

test("racing reclaims of an expired lease under the row lock produce one new attempt and one quota row", { skip }, () => withTrip(async t => {
  const command = t.command();
  const now = new Date("2027-01-01T10:00:00.000Z");
  const { turn } = await beginCoordinatorTurn(t.eventId, command, { ...t.options(t.owner), now });
  const later = new Date(now.getTime() + 200_000);
  const results = await Promise.all([1, 2, 3].map(() => beginCoordinatorTurn(t.eventId, command, { ...t.options(t.owner), now: later })));
  assert.deepEqual(results.map(result => result.kind).sort(), ["replayed", "replayed", "started"]);
  const winner = results.find(result => result.kind === "started")!;
  assert.deepEqual([winner.turn.turnId, winner.turn.attempt, winner.turn.status], [turn.turnId, 2, "pending"]);
  assert.equal(await t.count(coordinatorTurns, "commonsId"), 1);
  assert.equal(await t.reservations(), 2, "attempt 1 and attempt 2 each consumed one slot, once");
  const [row] = await t.db.db.select().from(coordinatorTurns).where(eq(coordinatorTurns.id, turn.turnId));
  assert.equal(lifecycleOf(row).leaseExpiresAt, new Date(later.getTime() + 120_000).toISOString());
}));

test("every removed CHECK is enforced in application code before the write", { skip }, () => withTrip(async t => {
  const command = t.command();
  const { turn } = await beginCoordinatorTurn(t.eventId, command, t.options(t.owner));
  const complete = (over: Record<string, unknown>) => completeCoordinatorTurn(t.eventId, { turnId: turn.turnId, commandId: command.commandId, attempt: 1, outcome: outcome(over) }, t.options(t.owner));
  await assert.rejects(complete({ assistantText: "   " }), "completed => non-empty answer");
  await assert.rejects(complete({ assistantText: "" }), "completed => non-empty answer");
  await assert.rejects(complete({ assistantText: "x".repeat(4001) }), "answer length is bounded");
  await assert.rejects(complete({ spokenReply: "x".repeat(2401) }), "spoken reply is bounded");
  await assert.rejects(complete({ workspace: { lifecycle: { v: 1, status: "failed", inputMode: "text", errorCode: null, attempt: 1, leaseExpiresAt: null, spokenReply: null, sources: [], completedAt: null } } as never }), "a caller cannot supply a lifecycle");
  const [row] = await t.db.db.select().from(coordinatorTurns).where(eq(coordinatorTurns.id, turn.turnId));
  assert.equal(lifecycleOf(row).status, "pending", "rejected completions left the pending turn untouched");
  // Long spoken replies from the model are cut to 600 characters, never rejected or stored longer.
  const done = await complete({ spokenReply: "y".repeat(2000) });
  assert.equal(done.spokenReply?.length, 600);
  // failed <=> error code, attempt 1..3: the schema refuses every combination the CHECKs used to refuse.
  const life = lifecycleOf((await t.db.db.select().from(coordinatorTurns).where(eq(coordinatorTurns.id, turn.turnId)))[0]);
  assert.equal(life.status, "completed");
  const bad = (over: object) => CoordinatorWorkspaceSchema.safeParse({ lifecycle: { ...life, ...over } }).success;
  assert.equal(bad({}), true);
  assert.equal(bad({ status: "failed" }), false, "failed needs an error code");
  assert.equal(bad({ errorCode: "provider_failed" }), false, "an error code needs status failed");
  assert.equal(bad({ attempt: 0 }), false);
  assert.equal(bad({ attempt: 4 }), false);
  assert.equal(bad({ spokenReply: "z".repeat(601) }), false);
  assert.equal(bad({ completedAt: null }), false, "completed needs completedAt");
}));

test("thread summary, open questions and title are bounded in code and live in workspace.threadState", { skip }, () => withTrip(async t => {
  const command = t.command();
  const { turn } = await beginCoordinatorTurn(t.eventId, command, t.options(t.owner));
  const done = await completeCoordinatorTurn(t.eventId, { turnId: turn.turnId, commandId: command.commandId, attempt: 1,
    outcome: outcome({ threadUpdate: { topicTitle: "Saturday dinner", summary: `  ${"S".repeat(900)}  `, openQuestions: ["Q1", "Q".repeat(500), "Q3", "Q4", "Q5"] } }) }, t.options(t.owner));
  const [row] = await t.db.db.select().from(coordinatorTurns).where(eq(coordinatorTurns.id, turn.turnId));
  const state = row.workspace!.threadState!;
  assert.deepEqual([state.summary!.length, state.summaryTurnVersion, state.openQuestions.length, state.openQuestions[1].length, state.generatedTitle], [400, 1, 3, 200, "Saturday dinner"]);
  assert.deepEqual([done.thread.title, done.thread.titleSource], ["Saturday dinner", "generated"]);
  // A later turn that only updates open questions carries the summary and title forward and records which turn it reflects.
  const next = t.command({ target: { kind: "existing", threadId: turn.threadId, expectedTurnVersion: 1 } });
  const second = await beginCoordinatorTurn(t.eventId, next, t.options(t.owner));
  await completeCoordinatorTurn(t.eventId, { turnId: second.turn.turnId, commandId: next.commandId, attempt: 1, outcome: outcome({ threadUpdate: { openQuestions: ["Which day?"] } }) }, t.options(t.owner));
  const [thread] = await t.db.db.select().from(coordinatorThreads).where(eq(coordinatorThreads.id, turn.threadId));
  const meta = (await readThreadMeta(t.db.db as never, t.eventId, [thread])).get(thread.id)!;
  assert.deepEqual([meta.state?.summary?.length, meta.state?.openQuestions, meta.state?.summaryTurnVersion, meta.state?.generatedTitle, meta.titleSource], [400, ["Which day?"], 2, "Saturday dinner", "generated"]);
  // An organizer rename (a change to the thread's title) turns the derived title source into "organizer".
  await t.db.db.update(coordinatorThreads).set({ title: "Our dinner plan" }).where(eq(coordinatorThreads.id, thread.id));
  assert.equal((await readThreadMeta(t.db.db as never, t.eventId, [{ ...thread, title: "Our dinner plan" }])).get(thread.id)!.titleSource, "organizer");
  // If production main rewrote the newest turn's workspace without threadState, the previous state is used again.
  const withoutState = { ...(await t.db.db.select().from(coordinatorTurns).where(eq(coordinatorTurns.id, second.turn.turnId)))[0].workspace! };
  delete withoutState.threadState;
  await t.db.db.update(coordinatorTurns).set({ workspace: withoutState }).where(eq(coordinatorTurns.id, second.turn.turnId));
  const fallback = (await readThreadMeta(t.db.db as never, t.eventId, [thread])).get(thread.id)!;
  assert.deepEqual([fallback.state?.openQuestions.length, fallback.state?.summaryTurnVersion], [3, 1]);
}));

test("pending turns are listed for the author only, bounded, with expired leases failed on read", { skip }, () => withTrip(async t => {
  const now = new Date("2027-01-01T10:00:00.000Z");
  const one = t.command(), two = t.command();
  await beginCoordinatorTurn(t.eventId, one, { ...t.options(t.owner), now });
  await beginCoordinatorTurn(t.eventId, two, { ...t.options(t.owner), now: new Date(now.getTime() + 100_000) });
  const live = await listPendingCoordinatorTurns(t.eventId, { ...t.options(t.owner), now: new Date(now.getTime() + 130_000) });
  assert.deepEqual(live.map(turn => turn.commandId), [two.commandId], "the first lease expired and was failed, the second is still in flight");
  assert.equal((await findCoordinatorTurnByCommand(t.eventId, one.commandId, t.options(t.owner)))?.status, "failed");
  assert.deepEqual(await listPendingCoordinatorTurns(t.eventId, { ...t.options(t.coOwner), now: new Date(now.getTime() + 130_000) }), [], "another organizer does not see this author's in-flight turns");
  await rejectsWith(listPendingCoordinatorTurns(t.eventId, t.options(t.traveler)), "organizer_required");
}));

test("a pending or failed turn cannot be acted on and its workspace never exposes internal keys", { skip }, () => withTrip(async t => {
  const command = t.command();
  const { turn } = await beginCoordinatorTurn(t.eventId, command, t.options(t.owner));
  await assert.rejects(actOnCoordinatorWorkspace(t.eventId, { turnId: turn.turnId, threadId: turn.threadId, commandId: randomUUID(), action: "save" }, t.options(t.owner)), (error: unknown) => (error as { coordinatorCode?: string }).coordinatorCode === "artifact_missing");
  assert.equal(publicWorkspace({ lifecycle: lifecycleOf({ workspace: null, createdAt: new Date() }) }), null);
  const done = await completeCoordinatorTurn(t.eventId, { turnId: turn.turnId, commandId: command.commandId, attempt: 1, outcome: outcome() }, t.options(t.owner));
  await actOnCoordinatorWorkspace(t.eventId, { turnId: turn.turnId, threadId: turn.threadId, commandId: randomUUID(), action: "save" }, t.options(t.owner));
  const [saved] = await t.db.db.select().from(coordinatorTurns).where(eq(coordinatorTurns.id, turn.turnId));
  assert.equal(saved.workspace?.saved, true);
  assert.equal(saved.workspace?.lifecycle?.status, "completed", "this code's reviewed actions keep the lifecycle");
  assert.equal(done.status, "completed");
}));

// ---------------------------------------------------------------------------
// Stage 8 fixes
// ---------------------------------------------------------------------------

test("R4 the hourly quota key includes the organizer: a second organizer reusing a command id still consumes a slot", { skip }, () => withTrip(async t => {
  const first = t.command();
  const started = await beginCoordinatorTurn(t.eventId, first, t.options(t.owner, { hourlyInferenceLimit: 2 }));
  const shared = { commandId: first.commandId, target: { kind: "existing" as const, threadId: started.turn.threadId, expectedTurnVersion: 1 }, inputMode: "text" as const, text: "A different request from the co-organizer" };
  const reused = await beginCoordinatorTurn(t.eventId, shared, t.options(t.coOwner, { hourlyInferenceLimit: 2 }));
  assert.equal(reused.kind, "started", "the command id is per organizer, so this is a new turn");
  assert.equal(await t.reservations(), 2, "each organizer's use counts; before the fix the second was swallowed by the first organizer's key");
  await rejectsWith(beginCoordinatorTurn(t.eventId, t.command(), t.options(t.coOwner, { hourlyInferenceLimit: 2 })), "rate_limited");
  // A replay by the same organizer still never double-counts.
  await beginCoordinatorTurn(t.eventId, first, t.options(t.owner, { hourlyInferenceLimit: 2 }));
  assert.equal(await t.reservations(), 2);
}));

test("R10 a lookup takes no lock: it answers while another request holds the trip row, and only lazily failing an expired lease waits for it", { skip }, () => withTrip(async t => {
  const command = t.command();
  const now = new Date();
  await beginCoordinatorTurn(t.eventId, command, { ...t.options(t.owner), now });
  const holder = createDatabase(t.url);
  let release!: () => void;
  const released = new Promise<void>(resolve => { release = resolve; });
  let locked!: () => void;
  const lockTaken = new Promise<void>(resolve => { locked = resolve; });
  const holding = holder.db.transaction(async tx => {
    await tx.select({ id: commons.id }).from(commons).where(eq(commons.id, t.eventId)).for("update");
    locked();
    await released;
  });
  try {
    await lockTaken;
    const within = <T,>(promise: Promise<T>, ms: number) => Promise.race([promise, new Promise<"blocked">(resolve => setTimeout(() => resolve("blocked"), ms))]);
    const read = await within(findCoordinatorTurnByCommand(t.eventId, command.commandId, { ...t.options(t.owner), now: new Date(now.getTime() + 30_000) }), 2_000);
    assert.notEqual(read, "blocked", "a plain lookup must not queue behind the trip lock");
    assert.equal((read as { status: string }).status, "pending");
    const lazy = findCoordinatorTurnByCommand(t.eventId, command.commandId, { ...t.options(t.owner), now: new Date(now.getTime() + 121_000) });
    assert.equal(await within(lazy.then(() => "done"), 400), "blocked", "failing an expired lease needs the lock, in begin's order");
    release();
    await holding;
    assert.deepEqual({ status: (await lazy)?.status, code: (await lazy)?.errorCode }, { status: "failed", code: "internal_error" });
  } finally { release(); await holding.catch(() => undefined); await holder.close(); }
}));

test("R11 a derived thread or draft id that already exists fails the turn with command_mismatch and writes nothing", { skip }, () => withTrip(async t => {
  const created = t.command();
  const started = await beginCoordinatorTurn(t.eventId, created, t.options(t.owner));
  // A thread with the id the dispatcher derived already exists (for instance, in another trip).
  const taken = randomUUID();
  await t.db.db.insert(coordinatorThreads).values({ id: taken, commonsId: t.elsewhere, createdByPersonId: t.owner, title: "Elsewhere", lastCommandId: randomUUID(), lastCommandFingerprint: "x" });
  const clash = await completeCoordinatorTurn(t.eventId, { turnId: started.turn.turnId, commandId: created.commandId, attempt: 1,
    outcome: outcome({ createThread: { id: taken, title: "Separate", commandId: randomUUID() } }) }, t.options(t.owner));
  assert.deepEqual({ status: clash.status, code: clash.errorCode }, { status: "failed", code: "command_mismatch" });
  assert.equal(await t.count(coordinatorThreads, "commonsId"), 1, "no thread was created in this trip");
  // The same for a draft id.
  const other = t.command();
  const second = await beginCoordinatorTurn(t.eventId, other, t.options(t.owner));
  const draftId = randomUUID();
  await t.db.db.insert(pollDrafts).values({ id: draftId, commonsId: t.elsewhere, ownerPersonId: t.owner, data: { ...draftData(), lifecycle: undefined } as never, lastCommandId: randomUUID(), lastCommandFingerprint: "x" });
  const draftClash = await completeCoordinatorTurn(t.eventId, { turnId: second.turn.turnId, commandId: other.commandId, attempt: 1,
    outcome: outcome({ newDraft: { id: draftId, data: { ...draftData(), settledFacts: "", presentationVersion: 2 } as never } }) }, t.options(t.owner));
  assert.deepEqual({ status: draftClash.status, code: draftClash.errorCode }, { status: "failed", code: "command_mismatch" });
  assert.equal(await t.count(pollDrafts, "commonsId"), 0);
}));

test("F1 a generated title applies only on the thread's first turn, never later, even while the title is still provisional", { skip }, () => withTrip(async t => {
  const first = t.command();
  const started = await beginCoordinatorTurn(t.eventId, first, t.options(t.owner));
  // The first turn returned no usable topic: the thread keeps its provisional title.
  const done = await completeCoordinatorTurn(t.eventId, { turnId: started.turn.turnId, commandId: first.commandId, attempt: 1, outcome: outcome() }, t.options(t.owner));
  assert.deepEqual({ title: done.thread.title, source: done.thread.titleSource }, { title: "Dinner Saturday", source: "provisional" });
  const second = t.command({ target: { kind: "existing", threadId: done.threadId, expectedTurnVersion: 1 } });
  const next = await beginCoordinatorTurn(t.eventId, second, t.options(t.owner));
  const later = await completeCoordinatorTurn(t.eventId, { turnId: next.turn.turnId, commandId: second.commandId, attempt: 1, outcome: outcome({ threadUpdate: { topicTitle: "Make a poll asking", summary: "Talked about a poll." } }) }, t.options(t.owner));
  assert.deepEqual({ title: later.thread.title, source: later.thread.titleSource, metadataVersion: later.thread.metadataVersion }, { title: "Dinner Saturday", source: "provisional", metadataVersion: done.thread.metadataVersion }, "a later turn never renames the thread");
  // The first turn still may.
  const fresh = t.command();
  const freshStart = await beginCoordinatorTurn(t.eventId, fresh, t.options(t.owner));
  const titled = await completeCoordinatorTurn(t.eventId, { turnId: freshStart.turn.turnId, commandId: fresh.commandId, attempt: 1, outcome: outcome({ threadUpdate: { topicTitle: "Dinner near the lodge" } }) }, t.options(t.owner));
  assert.deepEqual({ title: titled.thread.title, source: titled.thread.titleSource }, { title: "Dinner near the lodge", source: "generated" });
}));

test("activity completion rechecks organizer authority and refuses a forged receipt or mixed artifact outcome", {skip},()=>withTrip(async t=>{
 const command=t.command({text:"Add as ideas: Museum, Zoo"});const started=await beginCoordinatorTurn(t.eventId,command,t.options(t.owner));
 await t.db.db.update(memberships).set({status:"removed"}).where(and(eq(memberships.commonsId,t.eventId),eq(memberships.personId,t.owner)));
 const lost=await completeCoordinatorTurn(t.eventId,{turnId:started.turn.turnId,commandId:command.commandId,attempt:1,outcome:outcome({workspace:{capability:"add_activities"}})},t.options(t.owner));
 assert.equal(lost.status,"failed");assert.equal(lost.errorCode,"membership_lost");assert.equal((await t.db.db.select().from(itineraryItems).where(eq(itineraryItems.commonsId,t.eventId))).length,0);
 await t.db.db.update(memberships).set({status:"active"}).where(and(eq(memberships.commonsId,t.eventId),eq(memberships.personId,t.owner)));
 const ordinary=t.command({text:"What should we do?"});const pending=await beginCoordinatorTurn(t.eventId,ordinary,t.options(t.owner));
 const fake={at:new Date().toISOString(),items:[{id:randomUUID(),title:"Museum",status:"added"}]};
 const rejected=await completeCoordinatorTurn(t.eventId,{turnId:pending.turn.turnId,commandId:ordinary.commandId,attempt:1,outcome:outcome({workspace:{capability:"add_activities",activityReceipt:fake}})},t.options(t.owner));
 assert.equal(rejected.status,"failed");assert.equal(rejected.errorCode,"command_mismatch");assert.equal((await t.db.db.select().from(itineraryItems).where(eq(itineraryItems.commonsId,t.eventId))).length,0);
 const mixed=t.command({text:"Add activities: Museum"});const third=await beginCoordinatorTurn(t.eventId,mixed,t.options(t.owner));
 const noArtifact=await completeCoordinatorTurn(t.eventId,{turnId:third.turn.turnId,commandId:mixed.commandId,attempt:1,outcome:outcome({workspace:{capability:"add_activities"},newDraft:{id:randomUUID(),data:draftData()}})},t.options(t.owner));
 assert.equal(noArtifact.status,"failed");assert.equal(await t.count(pollDrafts,"commonsId"),0);
 const normal=t.command();const fourth=await beginCoordinatorTurn(t.eventId,normal,t.options(t.owner));
 const answer=await completeCoordinatorTurn(t.eventId,{turnId:fourth.turn.turnId,commandId:normal.commandId,attempt:1,outcome:outcome({workspace:{activityReceipt:fake}})},t.options(t.owner));
 assert.equal(answer.status,"completed");assert.equal(answer.workspace?.activityReceipt,undefined);
}));

test("a mid-list database failure rolls back activities, audit and receipt together",{skip},()=>withTrip(async t=>{
 const {addCoordinatorActivitiesInTransaction}=await import("./coordinator-activities-repository");
 await assert.rejects(t.db.db.transaction(async tx=>{
  // Force the second item to fail inside the real transaction, after the first insert.
  let count=0;
  const failing=new Proxy(tx,{get(target,key){if(key==="insert")return (table:unknown)=>{if(table===itineraryItems&&++count===2)throw new Error("synthetic second insert failure");return target.insert(table as typeof itineraryItems);};return Reflect.get(target,key);}});
  await addCoordinatorActivitiesInTransaction(failing,{tripId:t.eventId,actorPersonId:t.owner,turnId:randomUUID(),commandId:randomUUID(),userText:"Add activities: Museum, Zoo"});
 }),/synthetic second insert failure/);
 assert.equal((await t.db.db.select().from(itineraryItems).where(eq(itineraryItems.commonsId,t.eventId))).length,0);
 assert.equal((await t.db.db.select().from(processedCommands).where(eq(processedCommands.commonsId,t.eventId))).length,0);
}));

// Conversation durability A1: Stop versus commit is one defined race under the turn row lock (CONVERSATION-DURABILITY-TEST-PLAN.md A08, A14).
test("A08 Stop and commit racing on separate connections: exactly one wins, and the stored row, the stop outcome and the result agree", { skip }, () => withTrip(async t => {
  let stopsWon = 0, commitsWon = 0;
  for (let round = 0; round < 12; round += 1) {
    const command = t.command();
    const { turn } = await beginCoordinatorTurn(t.eventId, command, t.options(t.owner));
    const [completed, stop] = await Promise.all([
      completeCoordinatorTurn(t.eventId, { turnId: turn.turnId, commandId: command.commandId, attempt: 1, outcome: outcome() }, t.options(t.owner)),
      stopCoordinatorTurn(t.eventId, { commandId: command.commandId }, t.options(t.owner)),
    ]);
    const [row] = await t.db.db.select().from(coordinatorTurns).where(eq(coordinatorTurns.id, turn.turnId));
    const life = lifecycleOf(row);
    if (stop.outcome === "stopped") {
      stopsWon += 1;
      assert.equal(life.status, "failed"); assert.equal(row.workspace?.stop?.attempt, 1);
      assert.equal(completed.status, "failed", "the commit that lost returns the stored stopped turn and saves nothing");
      assert.equal(row.assistantText, COORDINATOR_FAILED_TURN_TEXT);
    } else {
      commitsWon += 1;
      assert.equal(stop.outcome, "already_completed"); assert.equal(life.status, "completed"); assert.equal(row.workspace?.stop, undefined);
      assert.equal(stop.turn.assistantText, "Try the early seating near the lodge.", "the stop that lost reports the saved answer");
    }
  }
  assert.equal(stopsWon + commitsWon, 12);
}));

test("A08 a stopped attempt is retried as a new attempt without the stop marker; stopping a finished failure says already_finished", { skip }, () => withTrip(async t => {
  const command = t.command();
  const { turn } = await beginCoordinatorTurn(t.eventId, command, t.options(t.owner));
  assert.equal((await stopCoordinatorTurn(t.eventId, { commandId: command.commandId }, t.options(t.owner))).outcome, "stopped");
  assert.equal(await coordinatorTurnAttemptIsLive(t.eventId, { commandId: command.commandId, attempt: 1 }, t.options(t.owner)), false);
  const retried = await beginCoordinatorTurn(t.eventId, command, t.options(t.owner));
  assert.equal(retried.kind, "started"); assert.equal(retried.turn.attempt, 2); assert.equal(retried.turn.workspace?.stop, undefined);
  assert.equal(await coordinatorTurnAttemptIsLive(t.eventId, { commandId: command.commandId, attempt: 2 }, t.options(t.owner)), true);
  await failCoordinatorTurn(t.eventId, { turnId: turn.turnId, commandId: command.commandId, attempt: 2, errorCode: "provider_failed" }, t.options(t.owner));
  assert.equal((await stopCoordinatorTurn(t.eventId, { commandId: command.commandId }, t.options(t.owner))).outcome, "already_finished");
}));

test("A14 an expired lease is failed once on lookup with an interruption marker, and a late completion of that attempt saves nothing", { skip }, () => withTrip(async t => {
  const command = t.command(), started = new Date("2027-01-01T10:00:00Z");
  const { turn } = await beginCoordinatorTurn(t.eventId, command, t.options(t.owner, { now: started }));
  const later = new Date(started.getTime() + 10 * 60_000);
  const found = await findCoordinatorTurnByCommand(t.eventId, command.commandId, t.options(t.owner, { now: later }));
  assert.equal(found?.status, "failed"); assert.equal(found?.errorCode, "internal_error");
  assert.equal(found?.workspace?.interruption?.reason, "lease_expired");
  const late = await completeCoordinatorTurn(t.eventId, { turnId: turn.turnId, commandId: command.commandId, attempt: 1, outcome: outcome() }, t.options(t.owner));
  assert.equal(late.status, "failed"); assert.equal(late.assistantText, null);
  const interrupted = await interruptCoordinatorTurn(t.eventId, { turnId: turn.turnId, commandId: command.commandId, attempt: 1, reason: "deadline" }, t.options(t.owner));
  assert.equal(interrupted.workspace?.interruption?.reason, "lease_expired", "an attempt that already ended keeps its first disposition");
}));

// Conversation durability A2 claim fencing (A05, A07) without processes: the same rules the runner relies on, against exact stored rows.
const durableInput = (command: TurnCommand) => ({ v: 1 as const, command: command as unknown as Record<string, unknown>, admission: { authUserId: null, operator: false, reserve: true, itineraryGeneration: false, provisionalTitle: "Dinner" } });
test("A07 a claim that expired before provider work is reclaimed with a new token; the stale token can neither renew, mark provider work nor commit", { skip }, () => withTrip(async t => {
  const command = t.command(), at = new Date("2027-01-01T10:00:00Z");
  const { turn } = await beginCoordinatorTurn(t.eventId, command, t.options(t.owner, { now: at, durable: durableInput(command) }));
  const first = await claimCoordinatorTurnExecution(turnExecutionHooks, { databaseUrl: t.url, workerId: "a", now: at, leaseMs: 1000 });
  assert.equal(first.kind, "claimed");
  const later = new Date(at.getTime() + 5000);
  const second = await claimCoordinatorTurnExecution(turnExecutionHooks, { databaseUrl: t.url, workerId: "b", now: later, leaseMs: 30_000 });
  assert.equal(second.kind, "claimed");
  if (first.kind !== "claimed" || second.kind !== "claimed") return;
  assert.notEqual(first.claim.token, second.claim.token); assert.equal(second.claim.claims, 2);
  const stale = { turnId: turn.turnId, attempt: 1, token: first.claim.token };
  assert.equal(await renewCoordinatorTurnExecution(turnExecutionHooks, stale, { databaseUrl: t.url, now: later }), false);
  assert.equal(await markCoordinatorTurnProviderStarted(stale, { databaseUrl: t.url, now: later }), false);
  const refused = await completeCoordinatorTurn(t.eventId, { turnId: turn.turnId, commandId: command.commandId, attempt: 1, outcome: outcome(), execution: { token: first.claim.token } }, t.options(t.owner));
  assert.equal(refused.status, "pending", "the stale writer saved nothing");
  const saved = await completeCoordinatorTurn(t.eventId, { turnId: turn.turnId, commandId: command.commandId, attempt: 1, outcome: outcome(), execution: { token: second.claim.token } }, t.options(t.owner));
  assert.equal(saved.status, "completed");
  const [row] = await t.db.db.select().from(coordinatorTurnExecutions).where(eq(coordinatorTurnExecutions.turnId, turn.turnId));
  assert.equal(row.status, "completed"); assert.equal(row.input, null); assert.equal(row.claimToken, null);
  // Without any token (the in-request path) a durably admitted attempt cannot be completed while a runner holds it.
  const other = t.command();
  const { turn: held } = await beginCoordinatorTurn(t.eventId, other, t.options(t.owner, { durable: durableInput(other) }));
  await claimCoordinatorTurnExecution(turnExecutionHooks, { databaseUrl: t.url, workerId: "c" });
  assert.equal((await completeCoordinatorTurn(t.eventId, { turnId: held.turnId, commandId: other.commandId, attempt: 1, outcome: outcome() }, t.options(t.owner))).status, "pending");
}));

test("A04 durable admission writes the turn and its execution row in one transaction; a replay writes neither again; a refused begin writes neither", { skip }, () => withTrip(async t => {
  const command = t.command();
  await beginCoordinatorTurn(t.eventId, command, t.options(t.owner, { durable: durableInput(command) }));
  await beginCoordinatorTurn(t.eventId, command, t.options(t.owner, { durable: durableInput(command) }));
  const rows = await t.db.db.select().from(coordinatorTurnExecutions).where(eq(coordinatorTurnExecutions.commonsId, t.eventId));
  assert.equal(rows.length, 1); assert.equal(rows[0].status, "queued");
  await assert.rejects(beginCoordinatorTurn(t.eventId, t.command(), t.options(t.traveler, { durable: durableInput(command) })), /organizer_required/);
  assert.equal((await t.db.db.select().from(coordinatorTurnExecutions).where(eq(coordinatorTurnExecutions.commonsId, t.eventId))).length, 1);
}));

test("A08 review fix (M1): Stop racing a runner claim on separate connections never deadlocks; the stored outcome is consistent", { skip }, () => withTrip(async t => {
  for (let round = 0; round < 10; round += 1) {
    const command = t.command();
    const { turn } = await beginCoordinatorTurn(t.eventId, command, t.options(t.owner, { durable: durableInput(command) }));
    const [stop, claim] = await Promise.all([
      stopCoordinatorTurn(t.eventId, { commandId: command.commandId }, t.options(t.owner)),
      claimCoordinatorTurnExecution(turnExecutionHooks, { databaseUrl: t.url, workerId: `r${round}` }),
    ]);
    assert.equal(stop.outcome, "stopped");
    const [row] = await t.db.db.select().from(coordinatorTurnExecutions).where(eq(coordinatorTurnExecutions.turnId, turn.turnId));
    assert.equal(row.status, "cancelled", `round ${round}: the execution ends cancelled whichever ran first (claim: ${claim.kind})`);
    if (claim.kind === "claimed") assert.equal(await renewCoordinatorTurnExecution(turnExecutionHooks, { turnId: turn.turnId, attempt: 1, token: claim.claim.token }, { databaseUrl: t.url }), false);
  }
}));


test("review R1: Stop wins over a task start waiting for its mutation transaction", { skip }, () => withTrip(async t => {
  const { startCoordinatorTask } = await import("./coordinator-task-repository");
  const command = t.command();
  const { turn } = await beginCoordinatorTurn(t.eventId, command, t.options(t.owner));
  // Reproduce the real preflight/transaction gap, with the trip row held by another write.
  assert.equal(await coordinatorTurnAttemptIsLive(t.eventId, { commandId: command.commandId, attempt: turn.attempt }, t.options(t.owner)), true);
  let release!: () => void, ready!: (pid: number) => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const acquired = new Promise<number>(resolve => { ready = resolve; });
  const lock = t.db.db.transaction(async tx => {
    await tx.select().from(commons).where(eq(commons.id, t.eventId)).for("update");
    const [row] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
    ready(row.pid); await held;
  });
  const pid = await acquired;
  const monitor = createDatabase(t.url);
  const options = { ...t.options(t.owner), turnFence: { commandId: command.commandId, attempt: turn.attempt } };
  const operation = startCoordinatorTask({ protocolVersion: 1, commandId: randomUUID(), commonsId: t.eventId, threadId: turn.threadId,
    parentTaskId: null, caller: { kind: "human", personId: t.owner }, capability: "research.public_sources", input: { query: "Breckenridge airport shuttle" },
    routing: { kind: "commons_specialist" }, returnTo: { kind: "commons_thread", threadId: turn.threadId } },
    { title: "Airport shuttle", brief: "Compare airport shuttles", contextVersion: null }, options).then(value => ({ value }), error => ({ error }));
  try {
    let blocked = false;
    for (let i = 0; i < 100; i++) {
      const [row] = await monitor.db.execute<{ blocked: boolean }>(sql`select exists(select 1 from pg_stat_activity where datname=current_database() and ${pid} = any(pg_blocking_pids(pid))) as blocked`);
      if (row.blocked) { blocked = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(blocked, true, "task mutation is waiting behind the trip lock");
    assert.equal((await stopCoordinatorTurn(t.eventId, { commandId: command.commandId }, t.options(t.owner))).outcome, "stopped");
  } finally { release(); await lock; await monitor.close(); }
  const result = await operation;
  assert.ok("error" in result, "a task must not be accepted after Stop committed");
  assert.ok(result.error instanceof CoordinatorTurnError);
}));


test("review R1: task and goal mutations require the live originating attempt, while direct controls still work", { skip }, () => withTrip(async t => {
  const { startCoordinatorTask, amendCoordinatorTask, cancelCoordinatorTask, readCoordinatorTask } = await import("./coordinator-task-repository");
  const { operateCoordinatorGoal } = await import("./coordinator-goal-repository");
  const command = t.command(), { turn } = await beginCoordinatorTurn(t.eventId, command, t.options(t.owner));
  const options = { ...t.options(t.owner), turnFence: { commandId: command.commandId, attempt: turn.attempt } };
  const task = await startCoordinatorTask({ protocolVersion: 1, commandId: randomUUID(), commonsId: t.eventId, threadId: turn.threadId,
    parentTaskId: null, caller: { kind: "human", personId: t.owner }, capability: "research.public_sources", input: { query: "Breckenridge airport shuttle" },
    routing: { kind: "commons_specialist" }, returnTo: { kind: "commons_thread", threadId: turn.threadId } },
    { title: "Airport shuttle", brief: "Compare airport shuttles", contextVersion: null }, options);
  const startGoal = () => ({ op: "start", commandId: randomUUID(), kind: "plan_action", title: "Airport transfer", goal: "Resolve how we get to the lodge." });
  const goal = await operateCoordinatorGoal(t.eventId, startGoal(), options);
  await stopCoordinatorTurn(t.eventId, { commandId: command.commandId }, t.options(t.owner));
  await assert.rejects(amendCoordinatorTask({ taskId: task.taskId, commandId: randomUUID(), expectedRevision: 1, note: "Use a smaller vehicle" }, options), CoordinatorTurnError);
  await assert.rejects(cancelCoordinatorTask({ taskId: task.taskId, commandId: randomUUID() }, options), CoordinatorTurnError);
  for (const operation of [startGoal(), { op: "amend", commandId: randomUUID(), goalId: goal.goal.goalId, expectedRevision: 1, note: "Use a smaller vehicle" },
    { op: "cancel", commandId: randomUUID(), goalId: goal.goal.goalId, expectedRevision: 1 }]) await assert.rejects(operateCoordinatorGoal(t.eventId, operation, options), CoordinatorTurnError);
  assert.equal((await readCoordinatorTask(task.taskId, t.options(t.owner))).revision, 1);
  const retry = await beginCoordinatorTurn(t.eventId, command, t.options(t.owner));
  assert.equal(retry.turn.attempt, 2);
  await assert.rejects(operateCoordinatorGoal(t.eventId, startGoal(), options), CoordinatorTurnError, "old attempt cannot mutate a live retry");
  await assert.rejects(operateCoordinatorGoal(t.eventId, startGoal(), { ...options, turnFence: { ...options.turnFence, attempt: 2, deadlineAt: Date.now() - 1 } }), CoordinatorTurnError, "expired deadline cannot mutate");
  assert.equal((await cancelCoordinatorTask({ taskId: task.taskId, commandId: randomUUID() }, t.options(t.owner))).cancelled, true, "direct task controls remain independent");
}));


// R4: an expired claim is fenced even before a replacement executor has claimed the row.
async function expiredUnreclaimedTurn(t: Awaited<ReturnType<typeof seed>>) {
  const command = t.command(), { turn } = await beginCoordinatorTurn(t.eventId, command, t.options(t.owner, { durable: durableInput(command) }));
  const claimed = await claimCoordinatorTurnExecution(turnExecutionHooks, { databaseUrl: t.url, workerId: "lease-regression" });
  assert.equal(claimed.kind, "claimed");
  assert.ok(claimed.kind === "claimed");
  const execution = { token: claimed.claim.token };
  await t.db.db.update(coordinatorTurnExecutions).set({ leaseExpiresAt: new Date(Date.now() - 1) }).where(eq(coordinatorTurnExecutions.turnId, turn.turnId));
  const [stored] = await t.db.db.select().from(coordinatorTurns).where(eq(coordinatorTurns.id, turn.turnId));
  assert.ok(Date.parse(lifecycleOf(stored).leaseExpiresAt!) > Date.now(), "parent turn lease is live: only execution lease must fence the write");
  const snapshot = async () => ({
    turn: (await t.db.db.select().from(coordinatorTurns).where(eq(coordinatorTurns.id, turn.turnId)))[0],
    execution: (await t.db.db.select().from(coordinatorTurnExecutions).where(eq(coordinatorTurnExecutions.turnId, turn.turnId)))[0],
    thread: (await t.db.db.select().from(coordinatorThreads).where(eq(coordinatorThreads.id, turn.threadId)))[0],
    drafts: await t.db.db.select().from(pollDrafts).where(eq(pollDrafts.commonsId, t.eventId)),
  });
  return { command, turn, execution, claim: claimed.claim, snapshot };
}

for (const operation of ["complete", "fail", "interrupt"] as const) {
  test(`R4 expired unreclaimed claim cannot ${operation} a still-live turn`, { skip }, () => withTrip(async t => {
    const x = await expiredUnreclaimedTurn(t), before = await x.snapshot();
    const input = { turnId: x.turn.turnId, commandId: x.command.commandId, attempt: x.turn.attempt, execution: x.execution };
    const result = operation === "complete" ? await completeCoordinatorTurn(t.eventId, { ...input, outcome: outcome({
      threadUpdate: { topicTitle: "Unauthorized expired reply", summary: "Must not save" },
      newDraft: { id: randomUUID(), data: { ...draftData(), settledFacts: "", presentationVersion: 2 } },
    }) }, t.options(t.owner)) : operation === "fail" ? await failCoordinatorTurn(t.eventId, { ...input, errorCode: "provider_failed" }, t.options(t.owner))
      : await interruptCoordinatorTurn(t.eventId, { ...input, reason: "deadline" }, t.options(t.owner));
    assert.equal(result.status, "pending", "expired writer cannot finish the attempt even without takeover");
    assert.deepEqual(await x.snapshot(), before, "no reply, draft, thread metadata or execution disposition changes");
  }));
}

test("R4 live execution claim still marks provider work, records progress and commits", { skip }, () => withTrip(async t => {
  const command = t.command(), { turn } = await beginCoordinatorTurn(t.eventId, command, t.options(t.owner, { durable: durableInput(command) }));
  const claim = await claimCoordinatorTurnExecution(turnExecutionHooks, { databaseUrl: t.url, workerId: "live-control" });
  assert.ok(claim.kind === "claimed");
  assert.equal(await markCoordinatorTurnProviderStarted(claim.claim, { databaseUrl: t.url }), true);
  const progress = { phase: "replying", text: "A current reply", seq: 1 };
  await recordCoordinatorTurnProgress(claim.claim, progress, { databaseUrl: t.url });
  const [row] = await t.db.db.select().from(coordinatorTurnExecutions).where(eq(coordinatorTurnExecutions.turnId, turn.turnId));
  assert.ok(row.providerStartedAt); assert.deepEqual(row.progress, progress);
  assert.equal((await completeCoordinatorTurn(t.eventId, { turnId: turn.turnId, commandId: command.commandId, attempt: 1, execution: { token: claim.claim.token }, outcome: outcome() }, t.options(t.owner))).status, "completed");
}));

for (const operation of ["provider marker", "progress"] as const) {
  test(`R4 expired unreclaimed claim cannot write ${operation} or renew`, { skip }, () => withTrip(async t => {
    const x = await expiredUnreclaimedTurn(t), before = await x.snapshot();
    if (operation === "provider marker") assert.equal(await markCoordinatorTurnProviderStarted(x.claim, { databaseUrl: t.url }), false);
    else await recordCoordinatorTurnProgress(x.claim, { phase: "replying", text: "Expired progress", seq: 1 }, { databaseUrl: t.url });
    assert.equal(await renewCoordinatorTurnExecution(turnExecutionHooks, x.claim, { databaseUrl: t.url }), false);
    assert.deepEqual(await x.snapshot(), before);
  }));
}

test("R4 execution expiry fences task and goal start, amend and cancel without takeover", { skip }, () => withTrip(async t => {
  const { startCoordinatorTask, amendCoordinatorTask, cancelCoordinatorTask } = await import("./coordinator-task-repository");
  const { operateCoordinatorGoal } = await import("./coordinator-goal-repository");
  const { researchTasks, coordinatorGoals } = await import("./schema");
  const x = await expiredUnreclaimedTurn(t);
  const options = { ...t.options(t.owner), turnFence: { commandId: x.command.commandId, attempt: 1, execution: x.execution } };
  const startTask = () => startCoordinatorTask({ protocolVersion: 1, commandId: randomUUID(), commonsId: t.eventId, threadId: x.turn.threadId,
    parentTaskId: null, caller: { kind: "human", personId: t.owner }, capability: "research.public_sources", input: { query: "Breckenridge airport shuttle" },
    routing: { kind: "commons_specialist" }, returnTo: { kind: "commons_thread", threadId: x.turn.threadId } },
    { title: "Airport shuttle", brief: "Compare airport shuttles", contextVersion: null }, options);
  const startGoal = () => ({ op: "start", commandId: randomUUID(), kind: "plan_action", title: "Airport transfer", goal: "Resolve how we get to the lodge." });
  // Establish positive coverage of this exact fence, then expire only its execution lease.
  await t.db.db.update(coordinatorTurnExecutions).set({ leaseExpiresAt: new Date(Date.now() + 30_000) }).where(eq(coordinatorTurnExecutions.turnId, x.turn.turnId));
  const task = await startTask(), goal = await operateCoordinatorGoal(t.eventId, startGoal(), options);
  await t.db.db.update(coordinatorTurnExecutions).set({ leaseExpiresAt: new Date(Date.now() - 1) }).where(eq(coordinatorTurnExecutions.turnId, x.turn.turnId));
  const taskSnapshot = async () => ({ tasks: await t.db.db.select().from(researchTasks).where(eq(researchTasks.commonsId, t.eventId)),
    goals: await t.db.db.select().from(coordinatorGoals).where(eq(coordinatorGoals.commonsId, t.eventId)),
    commands: await t.db.db.select().from(processedCommands).where(eq(processedCommands.commonsId, t.eventId)) });
  const before = await taskSnapshot();
  await assert.rejects(startTask(), CoordinatorTurnError);
  await assert.rejects(amendCoordinatorTask({ taskId: task.taskId, commandId: randomUUID(), expectedRevision: 1, note: "Use a smaller vehicle" }, options), CoordinatorTurnError);
  await assert.rejects(cancelCoordinatorTask({ taskId: task.taskId, commandId: randomUUID() }, options), CoordinatorTurnError);
  for (const op of [startGoal(), { op: "amend", commandId: randomUUID(), goalId: goal.goal.goalId, expectedRevision: 1, note: "Use a smaller vehicle" },
    { op: "cancel", commandId: randomUUID(), goalId: goal.goal.goalId, expectedRevision: 1 }]) await assert.rejects(operateCoordinatorGoal(t.eventId, op, options), CoordinatorTurnError);
  assert.deepEqual(await taskSnapshot(), before);
}));

for (const operation of ["renew", "complete", "provider marker", "progress"] as const) {
  test(`R4 ${operation} checks execution expiry after waiting for its row lock`, { skip }, () => withTrip(async t => {
    const command = t.command();
    const { turn } = await beginCoordinatorTurn(t.eventId, command, t.options(t.owner, { durable: durableInput(command) }));
    const claim = await claimCoordinatorTurnExecution(turnExecutionHooks, { databaseUrl: t.url, workerId: "waiting-writer" });
    assert.ok(claim.kind === "claimed");
    let release!: () => void, acquired!: (pid: number) => void;
    const held = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<number>(resolve => { acquired = resolve; });
    const holder = t.db.db.transaction(async tx => {
      await tx.select().from(coordinatorTurnExecutions).where(eq(coordinatorTurnExecutions.turnId, turn.turnId)).for("update");
      const [pid] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      acquired(pid.pid); await held;
      await tx.update(coordinatorTurnExecutions).set({ leaseExpiresAt: new Date() }).where(eq(coordinatorTurnExecutions.turnId, turn.turnId));
    });
    const pid = await ready, monitor = createDatabase(t.url);
    const pending = operation === "renew" ? renewCoordinatorTurnExecution(turnExecutionHooks, claim.claim, { databaseUrl: t.url })
      : operation === "provider marker" ? markCoordinatorTurnProviderStarted(claim.claim, { databaseUrl: t.url })
      : operation === "progress" ? recordCoordinatorTurnProgress(claim.claim, { phase: "replying", text: "Expired while waiting", seq: 1 }, { databaseUrl: t.url })
      : completeCoordinatorTurn(t.eventId, { turnId: turn.turnId, commandId: command.commandId, attempt: 1, execution: { token: claim.claim.token }, outcome: outcome() }, t.options(t.owner));
    try {
      let blocked = false;
      for (let i = 0; i < 100; i++) {
        const [row] = await monitor.db.execute<{ blocked: boolean }>(sql`select exists(select 1 from pg_stat_activity where datname=current_database() and ${pid} = any(pg_blocking_pids(pid))) as blocked`);
        if (row.blocked) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.equal(blocked, true, "the write is waiting on its execution lease row");
    } finally { release(); await holder; await monitor.close(); }
    const result = await pending;
    if (operation === "complete") { assert.ok(result && typeof result === "object"); assert.equal(result.status, "pending"); }
    else if (operation !== "progress") assert.equal(result, false, "eligibility must be checked at lock acquisition, not request start");
    const [row] = await t.db.db.select().from(coordinatorTurnExecutions).where(eq(coordinatorTurnExecutions.turnId, turn.turnId));
    assert.ok(row.leaseExpiresAt && row.leaseExpiresAt.getTime() <= Date.now());
    assert.equal(row.providerStartedAt, null); assert.equal(row.progress, null);
  }));
}
