import test from "node:test";
import assert from "node:assert/strict";
import { pilotSnapshot } from "../pilot-fixture";
import { actAs, databaseTestsEnabled, seedSyntheticTrip, testDatabaseUrl } from "../test-support/database-harness";
import { registerComponentImportStubs } from "../test-support/hook-harness";

/*
 * Home asks for the traveler's questions on every load, including on the sample trip, which is a fixture with no database row. Whoever is looking, and
 * whether or not a database is configured, there is nothing to list there, so the answer is an empty list rather than an error.
 */
const skip = !databaseTestsEnabled;
const route = () => { registerComponentImportStubs(); return import("../../app/api/v1/commons/[slug]/questions/route"); };
const ask = async (slug: string) => {
  const { GET } = await route();
  const response = await GET(new Request("http://localhost/x"), { params: Promise.resolve({ slug }) });
  return { status: response.status, body: await response.json() as { questions?: unknown[]; error?: { code: string } } };
};

test("the sample trip lists no questions: signed in, signed out, or with no database", { skip }, async () => {
  const trip = await seedSyntheticTrip();
  const saved = { DATABASE_URL: process.env.DATABASE_URL, COMMONS_PILOT_ACTOR_ID: process.env.COMMONS_PILOT_ACTOR_ID };
  try {
    for (const slug of [pilotSnapshot.commons.id, pilotSnapshot.commons.slug]) {
      actAs(trip.travelerId);
      const signedIn = await ask(slug);
      delete process.env.COMMONS_PILOT_ACTOR_ID;
      const signedOut = await ask(slug);
      delete process.env.DATABASE_URL;
      const noDatabase = await ask(slug);
      const empty = { status: 200, body: { questions: [] } };
      assert.deepEqual({ slug, signedIn, signedOut, noDatabase }, { slug, signedIn: empty, signedOut: empty, noDatabase: empty });
    }
    // A real trip is unchanged: a member gets a list, signed out still has to sign in.
    actAs(trip.travelerId);
    assert.deepEqual(await ask(trip.eventId), { status: 200, body: { questions: [] } });
    delete process.env.COMMONS_PILOT_ACTOR_ID;
    const signedOut = await ask(trip.eventId);
    assert.equal(signedOut.status, 401);
    assert.equal(signedOut.body.error?.code, "auth_required");
  } finally {
    process.env.DATABASE_URL = saved.DATABASE_URL ?? testDatabaseUrl();
    if (saved.COMMONS_PILOT_ACTOR_ID) process.env.COMMONS_PILOT_ACTOR_ID = saved.COMMONS_PILOT_ACTOR_ID;
    await trip.cleanup();
  }
});
