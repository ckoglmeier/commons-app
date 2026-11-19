import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { createDatabase } from "../../../packages/database/src/client";
import { commons, memberships, people } from "../../../packages/database/src/schema";
import { addCommonsItineraryItem, getCommonsSnapshot, updateCommonsItineraryItem } from "../../../packages/database/src/pilot-repository";
import { extractLinkPreview } from "./link-preview-core";

test("reviewed URL location and source survive real create, edit, retry and reload", { skip: process.env.COMMONS_RUN_DATABASE_TESTS !== "1" }, async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL!;
  assert.equal(new URL(databaseUrl).hostname, "127.0.0.1");
  assert.ok(new URL(databaseUrl).pathname.endsWith("_test"));
  const database = createDatabase(databaseUrl);
  const actor = randomUUID(), event = randomUUID(), slug = `url-import-${event}`;
  const options = { databaseUrl, actorPersonId: actor };
  try {
    await database.db.insert(people).values({ id: actor, displayName: "URL Import QA", authUserId: randomUUID() });
    await database.db.insert(commons).values({ id: event, slug, name: "URL import QA", timezone: "UTC", createdByPersonId: actor });
    await database.db.insert(memberships).values({ commonsId: event, personId: actor, role: "organizer", status: "active" });
    const location = "12 Museum Road, " + "Long district name ".repeat(6) + "Bath, UK";
    assert.ok(location.length > 120 && location.length <= 160);
    const preview = extractLinkPreview(new URL("https://example.com/museum"), `<title>Museum</title><script type="application/ld+json">${JSON.stringify({ "@type": "Event", name: "Museum", location: { address: location, openingHours: "Mo-Fr 09:00-17:00" } })}</script>`);
    assert.equal(preview.location, location);
    assert.equal((await getCommonsSnapshot(slug, options))!.state.itinerary.length, 0, "preview does not save");
    const command = { commandId: randomUUID(), title: preview.title, date: null, time: null, location: preview.location, note: preview.description, sourceUrl: preview.url, participantScope: "everyone", occurredAt: new Date().toISOString() };
    await addCommonsItineraryItem(slug, command, options);
    await addCommonsItineraryItem(slug, command, options);
    const saved = (await getCommonsSnapshot(slug, options))!.state.itinerary;
    assert.equal(saved.length, 1);
    assert.equal(saved[0].location, location);
    assert.equal(saved[0].sourceUrl, preview.url);
    assert.equal(saved[0].status, "idea");
    assert.equal(saved[0].note, "Published hours (local): Mon-Fri: 9:00 AM–5:00 PM");
    const edited = "Reviewed entrance: " + "A".repeat(141);
    assert.equal(edited.length, 160);
    await updateCommonsItineraryItem(slug, saved[0].id, { ...command, commandId: randomUUID(), location: edited }, options);
    const reloaded = (await getCommonsSnapshot(slug, options))!.state.itinerary[0];
    assert.equal(reloaded.location, edited);
    assert.equal(reloaded.sourceUrl, preview.url);
    assert.equal(reloaded.note, preview.description);
    await assert.rejects(updateCommonsItineraryItem(slug, saved[0].id, { ...command, commandId: randomUUID(), location: edited + "!" }, options));
  } finally {
    await database.db.delete(commons).where(eq(commons.id, event));
    await database.db.delete(people).where(eq(people.id, actor));
    await database.close();
  }
});
