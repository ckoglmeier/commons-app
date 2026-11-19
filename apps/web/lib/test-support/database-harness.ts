/**
 * Test-only harness for database integration tests: drives real route handlers against the disposable local test database, with the
 * local-development actor instead of Supabase auth. Never import from production code.
 *
 * Requires COMMONS_RUN_DATABASE_TESTS=1 and a TEST_DATABASE_URL on 127.0.0.1.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { commons, createDatabase, memberships, people, stayParticipants, stays } from "@commons/database";

export const databaseTestsEnabled = process.env.COMMONS_RUN_DATABASE_TESTS === "1";

export function testDatabaseUrl() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || new URL(url).hostname !== "127.0.0.1") throw new Error("Route harness requires a local TEST_DATABASE_URL.");
  return url;
}

/** Act as a person through the local-development pilot actor path (no Supabase). */
export function actAs(personId: string) {
  Object.assign(process.env, {
    NODE_ENV: "development",
    DATABASE_URL: testDatabaseUrl(),
    COMMONS_PILOT_ACTOR_ID: personId,
  });
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
}

export function jsonRequest(slug: string, path: string, method: string, body?: unknown) {
  return new Request(`http://localhost/api/v1/commons/${slug}${path}`, {
    method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export function params(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

/** Records `console.warn` structured events such as `commons.coordinator.turn_failed`. */
export function captureWarnings() {
  const original = console.warn;
  const events: Array<{ name: unknown; detail: unknown }> = [];
  console.warn = (name?: unknown, detail?: unknown) => { events.push({ name, detail }); };
  return { events, restore: () => { console.warn = original; } };
}

export type SyntheticTrip = { eventId: string; organizerId: string; coOrganizerId: string; travelerId: string; stayId: string; cleanup: () => Promise<void> };

/** A synthetic Breckenridge trip: two active organizers, one traveler, saved dates and one saved stay. */
export async function seedSyntheticTrip(): Promise<SyntheticTrip> {
  const url = testDatabaseUrl();
  const db = createDatabase(url);
  const eventId = randomUUID(), organizerId = randomUUID(), coOrganizerId = randomUUID(), travelerId = randomUUID(), stayId = randomUUID();
  const personIds = [organizerId, coOrganizerId, travelerId];
  try {
    await db.db.insert(people).values([
      { id: organizerId, displayName: "Casey Synthetic", authUserId: organizerId },
      { id: coOrganizerId, displayName: "Robin Synthetic", authUserId: coOrganizerId },
      { id: travelerId, displayName: "Taylor Synthetic", authUserId: travelerId },
    ]);
    await db.db.insert(commons).values({ id: eventId, slug: `qa-${eventId}`, name: "Synthetic Breckenridge weekend", timezone: "America/Denver",
      startsOn: "2027-02-12", endsOn: "2027-02-15", locationName: "Breckenridge, Colorado", createdByPersonId: organizerId });
    await db.db.insert(memberships).values([
      { commonsId: eventId, personId: organizerId, role: "organizer", status: "active" },
      { commonsId: eventId, personId: coOrganizerId, role: "organizer", status: "active" },
      { commonsId: eventId, personId: travelerId, role: "member", status: "active" },
    ]);
    await db.db.insert(stays).values({ id: stayId, commonsId: eventId, createdByPersonId: organizerId, name: "Synthetic Peak Lodge",
      address: "100 Synthetic Ridge Rd, Breckenridge, CO", startsOn: "2027-02-12", endsOn: "2027-02-15", status: "confirmed",
      totalCents: 184_000, costSource: "confirmation", includesTaxesAndFees: true, sourceLabel: "Added by Casey Synthetic" });
    await db.db.insert(stayParticipants).values(personIds.map(personId => ({ stayId, personId })));
  } finally { await db.close(); }
  return {
    eventId, organizerId, coOrganizerId, travelerId, stayId,
    cleanup: async () => {
      const cleanupDb = createDatabase(url);
      try {
        await cleanupDb.db.delete(commons).where(eq(commons.id, eventId));
        await cleanupDb.db.delete(people).where(inArray(people.id, personIds));
      } finally { await cleanupDb.close(); }
    },
  };
}

/** Direct read helper for assertions; bypasses route authorization deliberately. */
export async function withTestDatabase<T>(read: (db: ReturnType<typeof createDatabase>["db"]) => Promise<T>) {
  const database = createDatabase(testDatabaseUrl());
  try { return await read(database.db); } finally { await database.close(); }
}

export { and, eq };

