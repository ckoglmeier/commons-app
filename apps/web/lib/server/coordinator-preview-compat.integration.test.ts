import "../test-support/stub-server-only";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { execFileSync } from "node:child_process";
import { claimResearchTask, finishResearchTaskDetailed, queueResearchTask, runDatabaseMigrations } from "@commons/database";
import { actAs, databaseTestsEnabled, jsonRequest, loadCoordinatorRoutes, params, seedSyntheticTrip, testDatabaseUrl } from "./coordinator-route-harness";
// Goals are on by default; this compatibility case covers the Coordinator paths without them.
process.env.COMMONS_COORDINATOR_GOALS_ENABLED = "false";

/*
 * Preview and Production share one database, and a Preview build never migrates it. With the flag off, this release must therefore run on a database that is
 * still at the previous schema (without migration 0074). This test builds exactly that database (the migration prefix before 0074), then drives the real routes with
 * steering off: a conversation, the thread read, background research, and the closed continuity routes. Nothing here may touch an object 0074 adds.
 */
const skip = !databaseTestsEnabled;

test("with the flag off, the release runs on a database without migration 0074", { skip }, async () => {
  const base = new URL(testDatabaseUrl());
  const name = `commons_preview_compat_${randomUUID().replaceAll("-", "")}`;
  const admin = postgres(base.toString(), { max: 1, prepare: false, onnotice: () => undefined });
  const scratch = mkdtempSync(join(tmpdir(), "commons-migrations-"));
  const url = new URL(base); url.pathname = `/${name}`;
  const previous = { TEST_DATABASE_URL: process.env.TEST_DATABASE_URL, flag: process.env.COMMONS_COORDINATOR_STEERING_ENABLED, durable: process.env.COMMONS_DURABLE_RESEARCH_ENABLED };
  let trip: Awaited<ReturnType<typeof seedSyntheticTrip>> | undefined;
  try {
    await admin.unsafe(`CREATE DATABASE "${name}"`);
    execFileSync(process.execPath, ["--import", "tsx", "src/test-database-bootstrap.ts"], { cwd: new URL("../../../../packages/database/", import.meta.url), env: { ...process.env, DATABASE_DIRECT_URL: url.toString() }, stdio: "pipe" });
    // Preserve the exact pre-0074 schema as later additive migrations are introduced.
    const source = new URL("../../../../packages/database/migrations", import.meta.url).pathname;
    cpSync(source, scratch, { recursive: true });
    const journal = JSON.parse(readFileSync(join(scratch, "meta/_journal.json"), "utf8")) as { entries: Array<{ tag: string }> };
    const continuityIndex = journal.entries.findIndex(entry=>entry.tag === "0074_coordinator_continuity");
    assert.ok(continuityIndex>0,"the continuity migration is present");
    const omitted = journal.entries.splice(continuityIndex);
    writeFileSync(join(scratch, "meta/_journal.json"), JSON.stringify(journal));
    for(const entry of omitted)rmSync(join(scratch, `${entry.tag}.sql`));
    assert.ok(!readdirSync(scratch).some(file=>omitted.some(entry=>file===`${entry.tag}.sql`)));
    const migrator = postgres(url.toString(), { max: 1, prepare: false, onnotice: () => undefined });
    try { await runDatabaseMigrations(migrator, scratch); } finally { await migrator.end(); }
    // This release requires its additive Activity/task, currency, recipe, Meal, beta exemption and budget schema, but steering can still be rolled back independently. Recipe flag rollback retains run_id; it does not roll back schema.
    const additive = postgres(url.toString(), {max:1,prepare:false});
    try { for (const tag of ["0081_useful_wolverine", "0082_round_slapstick", "0083_unique_rawhide_kid", "0084_gifted_scalphunter", "0085_needy_outlaw_kid", "0086_cool_nocturne", "0087_left_wrecker", "0093_recipe_lifecycle", "0094_recipe_outcome_kinds", "0095_food_preferences", "0096_meal_types", "0097_meal_reservations", "0100_place_pins", "0101_stay_room_prices", "0104_beta_activation", "0105_trip_letter", "0106_beta_completion", "0107_beta_sms_messaging", "0108_trip_stages", "0109_new_experience", "0110_beta_do_not_charge", "0111_trip_budget_worksheets"]) { for(const statement of readFileSync(join(source, `${tag}.sql`),"utf8").split("--> statement-breakpoint")) if(statement.trim()) await additive.unsafe(statement); } } finally {await additive.end();}
    const probe = postgres(url.toString(), { max: 1, prepare: false });
    try { const [row] = await probe`select to_regclass('public.coordinator_task_state')::text as table_name`; assert.equal(row.table_name, null, "the steering tables are absent"); } finally { await probe.end(); }

    process.env.TEST_DATABASE_URL = url.toString();
    process.env.COMMONS_COORDINATOR_STEERING_ENABLED = "false";
    process.env.COMMONS_DURABLE_RESEARCH_ENABLED = "true";
    trip = await seedSyntheticTrip();
    const routes = await loadCoordinatorRoutes();
    actAs(trip.organizerId);
    process.env.OPENROUTER_API_KEY = "k"; process.env.OPENAI_API_KEY = "k";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).startsWith("https://api.openai.com/") || String(input).startsWith("https://openrouter.ai/")) return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ reply: "Try the early seating near your stay.", tripSuggestion: null, topicTitle: "Saturday dinner", threadSummary: "Early dinner.", openQuestions: [] }) } }] }), { status: 200, headers: { "content-type": "application/json" } });
      return originalFetch(input);
    }) as typeof fetch;
    try {
      const threadId = randomUUID();
      const turn = await routes.turns.POST(jsonRequest(trip.eventId, "/turns", "POST", { commandId: randomUUID(), target: { kind: "new", threadId }, inputMode: "text", text: "Where should the family eat on Saturday?" }), params(trip.eventId));
      assert.equal(turn.status, 200, await turn.clone().text());
      assert.equal(((await turn.json()) as { status: string }).status, "completed");
      const thread = await routes.turn.GET(new Request(`http://localhost/api/v1/commons/${trip.eventId}/coordinator?threadId=${threadId}`), params(trip.eventId));
      assert.equal(thread.status, 200); assert.equal(((await thread.json()) as { turns: unknown[] }).turns.length, 1);
      // Closed routes answer without touching the database objects the migration adds.
      const tasks = await routes.tasks.GET(new Request(`http://localhost/api/v1/commons/${trip.eventId}/coordinator/tasks?threadId=${threadId}`), params(trip.eventId));
      assert.deepEqual(((await tasks.json()) as { tasks: unknown[] }).tasks, []);
      assert.equal((await routes.continuity.GET(new Request(`http://localhost/api/v1/commons/${trip.eventId}/coordinator/continuity`), params(trip.eventId))).status, 404);
      assert.equal((await routes.tasks.POST(jsonRequest(trip.eventId, "/tasks", "POST", { op: "start", commandId: randomUUID(), threadId, title: "x", brief: "", query: "y" }), params(trip.eventId))).status, 404);
      // Background research, as it ran before this release, still queues, claims and finishes on the older schema.
      const request = { protocolVersion: 1, commandId: randomUUID(), commonsId: trip.eventId, threadId, parentTaskId: null, caller: { kind: "human", personId: trip.organizerId }, capability: "research.public_sources",
        input: { query: "Museum hours" }, routing: { kind: "commons_specialist" }, returnTo: { kind: "commons_thread", threadId } };
      await queueResearchTask(request, { databaseUrl: url.toString(), actorPersonId: trip.organizerId });
      const lease = await claimResearchTask(url.toString());
      assert.ok(lease);
      const finished = await finishResearchTaskDetailed(lease!, { result: { query: "Museum hours", status: "partial", sources: [], limitations: ["fixture"] } }, url.toString());
      assert.equal(finished.committed, true);
    } finally { globalThis.fetch = originalFetch; delete process.env.OPENROUTER_API_KEY; delete process.env.OPENAI_API_KEY; }
  } finally {
    await trip?.cleanup().catch(() => undefined);
    for (const [key, value] of [["TEST_DATABASE_URL", previous.TEST_DATABASE_URL], ["COMMONS_COORDINATOR_STEERING_ENABLED", previous.flag], ["COMMONS_DURABLE_RESEARCH_ENABLED", previous.durable]] as const) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(scratch, { recursive: true, force: true });
    await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.end();
  }
});
