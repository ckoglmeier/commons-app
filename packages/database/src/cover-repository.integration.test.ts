import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { createDatabase } from "./client";
import { getCommonsCoverAsset, updateCommonsCover } from "./pilot-repository";
import { commons, memberships, moments, people } from "./schema";

const run = process.env.COMMONS_RUN_DATABASE_TESTS === "1";

test("a standalone cover stores full and card assets without creating a trip photo", { skip: !run }, async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  assert.ok(databaseUrl, "TEST_DATABASE_URL or DATABASE_URL is required");
  const database = createDatabase(databaseUrl);
  const personIds: string[] = [];
  let commonsId: string | undefined;
  try {
    const [person] = await database.db.insert(people).values({ displayName: "Cover Organizer", authUserId: randomUUID() }).returning({ id: people.id });
    assert.ok(person);
    personIds.push(person.id);
    const slug = `cover-${randomUUID().slice(0, 8)}`;
    const [event] = await database.db.insert(commons).values({ slug, name: "Cover Asset Test", timezone: "America/Denver", createdByPersonId: person.id }).returning({ id: commons.id });
    assert.ok(event);
    commonsId = event.id;
    await database.db.insert(memberships).values({ commonsId, personId: person.id, status: "active", role: "organizer" });

    const assetId = randomUUID();
    const snapshot = await updateCommonsCover(slug, {
      commandId: randomUUID(),
      originalStoragePath: `${slug}/covers/${assetId}/original.jpg`,
      cardStoragePath: `${slug}/covers/${assetId}/card.webp`,
      mimeType: "image/jpeg",
      sourceMomentId: null,
    }, { databaseUrl, actorPersonId: person.id });

    assert.ok(snapshot);
    assert.match(snapshot.commons.coverImageUrl ?? "", /cover-image\?variant=original/);
    assert.match(snapshot.commons.coverCardImageUrl ?? "", /cover-image\?variant=card/);
    assert.equal(snapshot.commons.coverSourceMomentId, null);
    const photoRows = await database.db.select({ id: moments.id }).from(moments).where(eq(moments.commonsId, commonsId));
    assert.equal(photoRows.length, 0);

    await database.db.update(commons).set({ coverCardImageUrl: null, coverCardStoragePath: null }).where(eq(commons.id, commonsId));
    const incompleteCard = await getCommonsCoverAsset(slug, "card", { databaseUrl, actorPersonId: person.id });
    assert.deepEqual(incompleteCard, {
      storagePath: `${slug}/covers/${assetId}/card.webp`,
      mimeType: "image/webp",
      fallbackStoragePath: `${slug}/covers/${assetId}/original.jpg`,
    });

    const legacyMomentId = randomUUID();
    const legacyStoragePath = `${slug}/${legacyMomentId}.jpg`;
    await database.db.insert(moments).values({
      id: legacyMomentId,
      commonsId,
      storagePath: legacyStoragePath,
      mimeType: "image/jpeg",
      caption: "Legacy cover",
      altText: "Legacy cover test",
      occurredAt: new Date(),
      addedByPersonId: person.id,
      source: "web",
      sourceLabel: "Legacy test upload",
    });
    await database.db.update(commons).set({
      coverImageUrl: `/api/v1/commons/${slug}/moments/${legacyMomentId}`,
      coverCardImageUrl: null,
      coverOriginalStoragePath: null,
      coverCardStoragePath: null,
      coverMimeType: null,
    }).where(eq(commons.id, commonsId));
    const legacyCard = await getCommonsCoverAsset(slug, "card", { databaseUrl, actorPersonId: person.id });
    assert.deepEqual(legacyCard, {
      storagePath: `${slug}/cover-cards/${legacyMomentId}.webp`,
      mimeType: "image/webp",
      fallbackStoragePath: legacyStoragePath,
    });
    assert.equal(await getCommonsCoverAsset(slug, "original", { databaseUrl, actorPersonId: person.id }), null);
  } finally {
    if (commonsId) await database.db.delete(commons).where(eq(commons.id, commonsId));
    if (personIds.length) await database.db.delete(people).where(inArray(people.id, personIds));
    await database.close();
  }
});
