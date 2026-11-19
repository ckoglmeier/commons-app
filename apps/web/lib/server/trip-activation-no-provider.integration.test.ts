import test from "node:test";
import assert from "node:assert/strict";
import { actAs, databaseTestsEnabled, seedSyntheticTrip } from "../test-support/database-harness";
import { registerComponentImportStubs } from "../test-support/hook-harness";

/** Read-only activation state must work in the closed beta with no Stripe configuration. */
test("no-provider beta can read invitation state while checkout remains unavailable", { skip: !databaseTestsEnabled }, async () => {
  const keys = ["STRIPE_TEST_SECRET_KEY", "STRIPE_TEST_WEBHOOK_SECRET", "COMMONS_BETA_REWORK_ENABLED", "NODE_ENV", "DATABASE_URL", "COMMONS_PILOT_ACTOR_ID", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "VERCEL", "VERCEL_ENV"];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const trip = await seedSyntheticTrip();
  try {
    delete process.env.STRIPE_TEST_SECRET_KEY;
    delete process.env.STRIPE_TEST_WEBHOOK_SECRET;
    process.env.COMMONS_BETA_REWORK_ENABLED = "true";
    actAs(trip.organizerId);
    registerComponentImportStubs();
    const { GET } = await import("../../app/api/v1/trip-activation/status/route");
    const response = await GET(new Request(`http://localhost/api/v1/trip-activation/status?trip=${trip.eventId}`));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status.state, "exempt");
    assert.equal(body.status.mayInvite, true);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const { POST } = await import("../../app/api/v1/event-creation-drafts/[draftId]/checkout/route");
    const checkout = await POST(new Request("http://localhost/checkout", { method: "POST" }), { params: Promise.resolve({ draftId: "unused" }) });
    assert.equal(checkout.status, 404);
    process.env.COMMONS_BETA_REWORK_ENABLED = "false";
    assert.equal((await GET(new Request(`http://localhost/status?trip=${trip.eventId}`))).status, 404);
  } finally {
    await trip.cleanup();
    for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  }
});

test("an exempt committed draft opens first-invite without a payment provider", { skip: !databaseTestsEnabled }, async () => {
  const keys = ["STRIPE_TEST_SECRET_KEY", "STRIPE_TEST_WEBHOOK_SECRET", "COMMONS_BETA_REWORK_ENABLED", "NODE_ENV", "DATABASE_URL", "COMMONS_PILOT_ACTOR_ID", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "VERCEL", "VERCEL_ENV"];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const trip = await seedSyntheticTrip();
  const { createDatabase, createEventCreationDraft, commons, eventCreationDrafts, people } = await import("@commons/database");
  const { eq } = await import("drizzle-orm");
  const database = createDatabase(process.env.TEST_DATABASE_URL!);
  let draftId: string | null = null;
  try {
    delete process.env.STRIPE_TEST_SECRET_KEY;
    delete process.env.STRIPE_TEST_WEBHOOK_SECRET;
    process.env.COMMONS_BETA_REWORK_ENABLED = "true";
    actAs(trip.organizerId);
    await database.db.update(people).set({ doNotCharge: true }).where(eq(people.id, trip.organizerId));
    const draft = await createEventCreationDraft({ sourceKind: "description", title: "Synthetic exempt trip", timezone: "UTC" }, { databaseUrl: process.env.TEST_DATABASE_URL, actorPersonId: trip.organizerId, betaActivationRequired: true });
    draftId = draft.id;
    await database.db.update(eventCreationDrafts).set({ committedEventId: trip.eventId, committedEventSlug: trip.eventId }).where(eq(eventCreationDrafts.id, draft.id));
    await database.db.update(commons).set({ activationDraftId: draft.id, newExperience: true }).where(eq(commons.id, trip.eventId));
    registerComponentImportStubs();
    const { default: FirstInvitePage } = await import("../../app/c/[slug]/first-invite/page");
    const page = await FirstInvitePage({ params: Promise.resolve({ slug: trip.eventId }), searchParams: Promise.resolve({}) });
    assert.equal(page.type, "main", "no not-found or redirect for an eligible exempt owner");
  } finally {
    await database.db.update(commons).set({ activationDraftId: null }).where(eq(commons.id, trip.eventId));
    if (draftId) await database.db.delete(eventCreationDrafts).where(eq(eventCreationDrafts.id, draftId));
    await database.close();
    await trip.cleanup();
    for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  }
});
