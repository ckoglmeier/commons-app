import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { bootstrapTestDatabase } from "./test-database-bootstrap";
import { runDatabaseMigrations } from "./migration-state";

test("release migrations preserve existing Activities, private flights, stays, participants and links", {
  skip: process.env.COMMONS_RUN_DATABASE_TESTS !== "1",
}, async () => {
  const base = process.env.TEST_DATABASE_URL!;
  const name = `commons_release_preservation_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(base);
  url.pathname = `/${name}`;
  const admin = postgres(base, { max: 1, onnotice: () => {} });
  let client: postgres.Sql | undefined;
  try {
    await admin.unsafe(`CREATE DATABASE "${name}"`);
    await bootstrapTestDatabase(url.toString());
    client = postgres(url.toString(), { max: 1, onnotice: () => {} });
    const folder = new URL("../migrations", import.meta.url).pathname;
    const migrations = readMigrationFiles({ migrationsFolder: folder });
    await client.unsafe("CREATE SCHEMA drizzle");
    await client.unsafe("CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint)");
    for (const migration of migrations.slice(0, 81)) {
      await client.begin(async tx => {
        for (const statement of migration.sql) await tx.unsafe(statement);
        await tx`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${migration.hash}, ${migration.folderMillis})`;
      });
    }
    const actor = randomUUID(), invited = randomUUID(), trip = randomUUID();
    const flight = randomUUID(), activity = randomUUID(), stay = randomUUID();
    await client`INSERT INTO people (id, display_name) VALUES (${actor}, 'Synthetic organizer'), (${invited}, 'Synthetic invitee')`;
    await client`INSERT INTO commons (id, slug, name, timezone, created_by_person_id) VALUES (${trip}, ${`preserve-${trip}`}, 'Synthetic trip', 'America/Los_Angeles', ${actor})`;
    await client`INSERT INTO memberships (commons_id, person_id, role, status) VALUES (${trip}, ${actor}, 'organizer', 'active'), (${trip}, ${invited}, 'member', 'invited')`;
    await client`INSERT INTO itinerary_items (id, commons_id, title, timezone, audience, status, provenance_label, source_url) VALUES (${activity}, ${trip}, 'Confirmed activity without time', 'America/Los_Angeles', 'everyone', 'confirmed', 'Saved record', 'https://example.com/activity')`;
    await client`INSERT INTO travel_plans (id, commons_id, person_id, kind, date, route, time, visibility, confirmation_code, total_cents, source_label) VALUES (${flight}, ${trip}, ${actor}, 'arrival', '2026-11-05', 'DEN → SFO', '13:12', 'private', 'PRIVATE-SYNTHETIC', 12345, 'Saved record')`;
    await client`INSERT INTO travel_plan_participants (travel_plan_id, person_id) VALUES (${flight}, ${actor}), (${flight}, ${invited})`;
    await client`INSERT INTO stays (id, commons_id, created_by_person_id, name, address, starts_on, ends_on, status, source_label) VALUES (${stay}, ${trip}, ${actor}, 'Synthetic lodge', 'Synthetic address', '2026-11-05', '2026-11-08', 'confirmed', 'Saved record')`;
    const tables = ["people", "commons", "memberships", "itinerary_items", "travel_plans", "travel_plan_participants", "stays"];
    const before = await Promise.all(tables.map(table => client!.unsafe(`SELECT row_to_json(t) AS value FROM "${table}" t ORDER BY row_to_json(t)::text`)));
    // Preserve tasks created in the release preview before optional links and Brain reminders landed.
    for (const migration of migrations.slice(81,85)) await client.begin(async tx=>{
      for(const statement of migration.sql)await tx.unsafe(statement);
      await tx`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${migration.hash}, ${migration.folderMillis})`;
    });
    const todo=randomUUID();
    await client`INSERT INTO trip_tasks (id,commons_id,created_by_person_id,owner_person_id,title,item_kind,item_id,completed)
      VALUES (${todo},${trip},${actor},${invited},'Existing linked reminder','stay',${stay},true)`;
    const [taskBefore]=await client`SELECT row_to_json(t) AS value FROM trip_tasks t WHERE id=${todo}`;
    await runDatabaseMigrations(client, folder);
    const [taskAfter]=await client`SELECT row_to_json(t) AS value FROM trip_tasks t WHERE id=${todo}`;
    const {brain_finding_key,...originalTask}=taskAfter.value;
    assert.equal(brain_finding_key,null);
    assert.deepEqual(originalTask,taskBefore.value,"optional links preserve existing task ownership, linkage, completion and versions");
    for (const [index, table] of tables.entries()) {
      const after: Array<{ value: Record<string, unknown> }> = await client.unsafe(`SELECT row_to_json(t) AS value FROM "${table}" t ORDER BY row_to_json(t)::text`);
      const pinKeys = ["pin_latitude", "pin_longitude", "pin_precision", "pin_source"];
      const additiveKeys = table === "people" ? ["do_not_charge"] : table === "itinerary_items" ? ["scheduled_date", "expected_cost_currency", "meal_type", ...pinKeys] : table === "stays" ? ["timezone", "room_price_cents", "room_count", ...pinKeys] : table === "commons" ? ["welcome_message", "welcome_author_person_id", "letter_sections", "currency", "target_budget_currency", "activation_draft_id", "going_at", "big_questions", "new_experience"] : [];
      if (table === "itinerary_items" || table === "stays") for (const row of after) assert.ok(pinKeys.every(key => row.value[key] === null), `${table}: existing places gain no map pin`);
      if (table === "stays") for (const row of after) assert.ok(row.value.room_price_cents === null && row.value.room_count === null, "existing stays gain no room pricing");
      if (table === "people") for (const row of after) assert.equal(row.value.do_not_charge, true, "existing beta people receive the approved fee exemption");
      if (table === "commons") for (const row of after) {
        assert.equal(row.value.new_experience, false, "existing trips keep today's experience until an organizer changes it");
        assert.equal(row.value.activation_draft_id, null, "a trip existing at cutover is exempt from activation");
        assert.equal(row.value.currency, "USD", "legacy trip defaults remain USD");
        assert.equal(row.value.target_budget_currency, "USD", "legacy budget targets remain USD");
      }
      if (table === "itinerary_items") for (const row of after) { assert.equal(row.value.expected_cost_currency, "USD", "legacy activity estimates remain USD"); assert.equal(row.value.meal_type, null, "existing activities are not relabeled as meals"); }
      const originalColumns: Array<{ value: Record<string, unknown> }> = after.map(row => ({ value: Object.fromEntries(Object.entries(row.value).filter(([key]) => !additiveKeys.includes(key))) }));
      assert.deepEqual(originalColumns, [...before[index]], `${table}: no existing values, IDs or links changed`);
    }
    await runDatabaseMigrations(client, folder);
    assert.equal((await client`SELECT visibility FROM travel_plans WHERE id = ${flight}`)[0].visibility, "private");
  } finally {
    await client?.end();
    await admin.unsafe(`DROP DATABASE IF EXISTS "${name}"`);
    await admin.end();
  }
});
