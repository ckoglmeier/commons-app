import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { planTemplateFor } from "@commons/domain";
import { createDatabase } from "./client";
import { commitEventCreationDraft, createEventCreationDraft } from "./event-creation-repository";
import { commons, people, tripTasks } from "./schema";

const run = process.env.COMMONS_RUN_DATABASE_TESTS === "1";

test("committing a plan template draft stores its key and creates its starter to-dos", { skip: !run }, async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  assert.ok(databaseUrl, "TEST_DATABASE_URL or DATABASE_URL is required");
  const database = createDatabase(databaseUrl);
  const [organizer] = await database.db.insert(people).values({ displayName: "Template Organizer" }).returning();
  const createdIds: string[] = [];
  try {
    const options = { databaseUrl, actorPersonId: organizer.id };
    const commit = async (title: string, templateKey?: string) => {
      const draft = await createEventCreationDraft({ sourceKind: "description", title, timezone: "America/Denver", templateKey }, options);
      const committed = await commitEventCreationDraft(draft.id, { commandId: randomUUID(), expectedVersion: draft.version }, options);
      createdIds.push(committed.eventId);
      const [saved] = await database.db.select().from(commons).where(eq(commons.id, committed.eventId));
      const tasks = await database.db.select().from(tripTasks).where(eq(tripTasks.commonsId, committed.eventId));
      return { draft, saved, tasks };
    };

    const reunion = await commit("Summer reunion", "family-reunion");
    assert.equal(reunion.draft.templateKey, "family-reunion");
    assert.equal(reunion.saved.templateKey, "family-reunion");
    assert.deepEqual(reunion.tasks.map(task => task.title).sort(), planTemplateFor("family-reunion").todos.map(todo => todo.title).sort());
    assert.equal(reunion.tasks.length, 3);
    assert.ok(reunion.tasks.every(task => task.ownerPersonId === organizer.id && task.dueOn === null && !task.completed));

    const trip = await commit("Weekend away");
    assert.equal(trip.saved.templateKey, "travel-general");
    assert.equal(trip.tasks.length, 0);

    const unknown = await commit("Odd plan", "not-a-template");
    assert.equal(unknown.saved.templateKey, "travel-general");
    assert.equal(unknown.tasks.length, 0);
  } finally {
    if (createdIds.length) await database.db.delete(commons).where(inArray(commons.id, createdIds));
    await database.db.delete(people).where(eq(people.id, organizer.id));
    await database.close();
  }
});
