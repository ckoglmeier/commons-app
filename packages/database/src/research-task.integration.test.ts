import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "./client";
import { commons, people, memberships, coordinatorThreads, coordinatorResearchRuns, researchTasks } from "./schema";
import { queueResearchTask, readResearchTask, cancelResearchTask, claimResearchTask, finishResearchTask } from "./research-task-repository";
import { runResearchTask } from "./research-worker";
import { DELIVERY_LEASE_MS, DELIVERY_RETRY_MS } from "./delivery-lease";

const enabled = process.env.COMMONS_RUN_DATABASE_TESTS === "1";
test("durable research: replay, recovery, fencing, cancellation, revocation and browser denial", { skip: !enabled }, async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  assert.ok(databaseUrl);
  const db = createDatabase(databaseUrl);
  const actor = randomUUID(), outsider = randomUUID(), event = randomUUID(), thread = randomUUID();
  const options = { databaseUrl, actorPersonId: actor };
  await db.db.insert(people).values([{ id: actor, displayName: "Synthetic organizer" }, { id: outsider, displayName: "Synthetic outsider" }]);
  await db.db.insert(commons).values({ id: event, slug: `research-${event}`, name: "Synthetic research", timezone: "UTC", createdByPersonId: actor });
  await db.db.insert(memberships).values({ commonsId: event, personId: actor, role: "organizer", status: "active" });
  await db.db.insert(coordinatorThreads).values({ id: thread, commonsId: event, createdByPersonId: actor, title: "Research",
    lastCommandId: randomUUID(), lastCommandFingerprint: "fixture" });
  const request = () => ({ protocolVersion: 1, commandId: randomUUID(), commonsId: event, threadId: thread, parentTaskId: null,
    caller: { kind: "human", personId: actor }, capability: "research.public_sources", input: { query: "Museum hours" },
    routing: { kind: "commons_specialist" }, returnTo: { kind: "commons_thread", threadId: thread } });
  const result = { query: "Museum hours", status: "partial" as const, sources: [], limitations: ["Fixture has no live source"] };
  try {
    const input = request();
    const [one, two] = await Promise.all([queueResearchTask(input, options), queueResearchTask(input, options)]);
    assert.deepEqual(one, two);
    await assert.rejects(queueResearchTask({ ...input, input: { query: "Changed" } }, options));
    await assert.rejects(queueResearchTask(input, { ...options, actorPersonId: outsider }));
    await assert.rejects(queueResearchTask({ ...request(), routing: { kind: "personal_agent", personId: actor, agentId: randomUUID() } }, options));
    await assert.rejects(readResearchTask(one.taskId, { ...options, actorPersonId: outsider }));
    const now = new Date();
    // A separate worker process claims work and exits without completing it.
    const first = JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
      "import { claimResearchTask } from './packages/database/src/research-task-repository.ts'; console.log(JSON.stringify(await claimResearchTask(process.env.TEST_DATABASE_URL)));",
    ], { cwd: new URL("../../../", import.meta.url), encoding: "utf8" })); assert.ok(first);
    assert.equal(await claimResearchTask(databaseUrl, now), null);
    const later = new Date(Date.now() + DELIVERY_LEASE_MS + 1);
    const replacement = await claimResearchTask(databaseUrl, later); assert.ok(replacement);
    assert.notEqual(first.attemptId, replacement.attemptId);
    assert.equal(await finishResearchTask(first, { result }, databaseUrl, later), false);
    await db.db.update(coordinatorThreads).set({ version: 2, title: "Edited during research" }).where(eq(coordinatorThreads.id, thread));
    assert.equal(await finishResearchTask(replacement, { result }, databaseUrl, later), true);
    assert.equal(await finishResearchTask(replacement, { result }, databaseUrl, later), false);
    const recovered = await readResearchTask(one.taskId, options);
    assert.equal(recovered.status, "succeeded");
    assert.deepEqual(recovered.attempts.map(a => a.status), ["expired", "succeeded"]);
    assert.equal((await db.db.select().from(coordinatorResearchRuns).where(eq(coordinatorResearchRuns.threadId, thread))).length, 1);
    const cancelled = await queueResearchTask(request(), options);
    const lease = await claimResearchTask(databaseUrl); assert.ok(lease);
    await cancelResearchTask(cancelled.taskId, options);
    assert.equal(await finishResearchTask(lease, { result }, databaseUrl), false);
    assert.equal((await readResearchTask(cancelled.taskId, options)).status, "cancelled");
    const timed = await queueResearchTask(request(), options);
    await runResearchTask(() => new Promise(() => {}), { databaseUrl, timeoutMs: 5 });
    const timeout = await readResearchTask(timed.taskId, options);
    assert.equal(timeout.status, "pending"); assert.equal(timeout.errorCode, "deadline_exceeded");
    assert.equal(await claimResearchTask(databaseUrl), null);
    await runResearchTask(async () => result, { databaseUrl, now: () => new Date(Date.now() + DELIVERY_RETRY_MS + 1000) });
    assert.equal((await readResearchTask(timed.taskId, options)).status, "succeeded");
    const revoked = await queueResearchTask(request(), options);
    const revokedLease = await claimResearchTask(databaseUrl); assert.ok(revokedLease);
    await db.db.update(memberships).set({ role: "member" }).where(eq(memberships.personId, actor));
    assert.equal(await finishResearchTask(revokedLease, { result }, databaseUrl), true);
    await assert.rejects(readResearchTask(revoked.taskId, options));
    await assert.rejects(queueResearchTask(input, options));
    const [row] = await db.db.select().from(researchTasks).where(eq(researchTasks.id, revoked.taskId));
    assert.equal(row.status, "failed"); assert.equal(row.errorCode, "access_revoked"); assert.equal(row.result, null);
    await db.db.update(memberships).set({ role: "organizer" }).where(eq(memberships.personId, actor));
    const exhausted = await queueResearchTask(request(), options);
    let retryAt = new Date();
    for (let attempt = 1; attempt <= 5; attempt++) {
      const work = await claimResearchTask(databaseUrl, retryAt); assert.ok(work);
      assert.equal(work.attempt, attempt);
      await finishResearchTask(work, { errorCode: "provider_failed" }, databaseUrl, retryAt);
      retryAt = new Date(retryAt.getTime() + DELIVERY_RETRY_MS + 1);
    }
    assert.equal((await readResearchTask(exhausted.taskId, options)).status, "failed");
    assert.equal(await claimResearchTask(databaseUrl, retryAt), null);
    for (const role of ["anon", "authenticated"]) {
      await assert.rejects(db.db.transaction(async tx => {
        await tx.execute(sql.raw(`SET LOCAL ROLE ${role}`));
        await tx.select().from(researchTasks);
      }));
    }
  } finally {
    await db.db.delete(commons).where(eq(commons.id, event));
    await db.db.delete(people).where(eq(people.id, actor));
    await db.db.delete(people).where(eq(people.id, outsider));
    await db.close();
  }
});
