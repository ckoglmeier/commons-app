import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { createDatabase } from "./client";
import { loadFreeBetaFunnel } from "./daily-analytics-repository";
import { commons, expenses, identities, invitations, memberships, people, pollResponses, polls, productAnalyticsEvents } from "./schema";
import { hashNormalizedEmail } from "./tokens";

const run = process.env.COMMONS_RUN_DATABASE_TESTS === "1";
const at = (value: string) => new Date(`${value}Z`);

test("free-beta funnel counts saved records once, by role, and excludes the sample, QA trips and internal accounts", { skip: !run }, async () => {
  const url = process.env.TEST_DATABASE_URL;
  assert.ok(url && ["localhost", "127.0.0.1"].includes(new URL(url).hostname) && new URL(url).pathname.endsWith("_test"));
  const database = createDatabase(url);
  const db = database.db;
  const suffix = randomUUID().slice(0, 8);
  const earlier = at("2031-01-01T15:00:00"), day = at("2031-01-10T15:00:00");
  const window = { startsAt: at("2031-01-10T00:00:00"), endsAt: at("2031-01-11T00:00:00") };
  const personIds: string[] = [], tripIds: string[] = [], authA = randomUUID();
  let restoreSample: { id: string; createdAt: Date } | null = null;
  let insertedSample: string | null = null;
  try {
    const person = async (name: string, authUserId?: string) => { const [row] = await db.insert(people).values({ displayName: name, authUserId }).returning({ id: people.id }); personIds.push(row.id); return row.id; };
    const trip = async (name: string, createdBy: string, createdAt: Date, slug = `funnel-${suffix}-${randomUUID().slice(0, 6)}`) => {
      const [row] = await db.insert(commons).values({ slug, name, timezone: "UTC", createdByPersonId: createdBy, createdAt } as never).returning({ id: commons.id, slug: commons.slug });
      tripIds.push(row.id); return row;
    };
    const member = (tripId: string, personId: string, role: "organizer" | "member", createdAt: Date) => db.insert(memberships).values({ commonsId: tripId, personId, role, status: "active", createdAt } as never);
    const poll = async (tripId: string, by: string, createdAt: Date) => { const [row] = await db.insert(polls).values({ commonsId: tripId, createdByPersonId: by, commandId: randomUUID(), title: "Where?", ballotMode: "transparent", questions: [], shareTokenHash: randomUUID(), shareTokenValue: randomUUID(), createdAt } as never).returning({ id: polls.id }); return row.id; };
    const response = (pollId: string, personId: string | null, submittedAt: Date) => db.insert(pollResponses).values({ pollId, respondentPersonId: personId, respondentName: "R", receiptTokenHash: randomUUID(), answers: [], submittedAt } as never);

    const organizer = await person("Funnel Organizer", authA);
    const participant = await person("Funnel Participant");
    const internal = await person("Funnel Internal");
    const internalEmail = `internal-${suffix}@example.test`;
    await db.insert(identities).values({ personId: internal, kind: "email", normalizedHash: hashNormalizedEmail(internalEmail) } as never);

    // Trip 1: created earlier; organizer returns on the report day; participant responds and spends on the report day.
    const trip1 = await trip("Funnel Trip One", organizer, earlier);
    await member(trip1.id, organizer, "organizer", earlier); await member(trip1.id, participant, "member", earlier);
    const poll1 = await poll(trip1.id, organizer, earlier);
    await response(poll1, participant, day);
    await db.insert(expenses).values({ commonsId: trip1.id, title: "Dinner", amountCents: 1000, paidByPersonId: participant, createdByPersonId: participant, occurredOn: "2031-01-10", category: "food", splitMethod: "equal", source: "web", sourceLabel: "web", createdAt: day } as never);
    // Duplicate organizer page views must count the trip once; a same-day view of trip 2 must not count.
    const view = (slug: string, when: Date) => ({ id: randomUUID(), eventName: "page_view", anonymousId: randomUUID(), sessionId: randomUUID(), authUserId: authA, commonsSlug: slug, pagePath: `/c/${slug}`, properties: {}, occurredAt: when });
    // Trip 2: created on the day by the repeat organizer; first poll published on the day; two link responses and the organizer's own.
    const trip2 = await trip("Funnel Trip Two", organizer, day);
    await member(trip2.id, organizer, "organizer", day);
    const poll2 = await poll(trip2.id, organizer, day);
    await response(poll2, null, day); await response(poll2, null, day); await response(poll2, organizer, day);
    await db.insert(productAnalyticsEvents).values([view(trip1.slug, day), view(trip1.slug, at("2031-01-10T18:00:00")), view(trip2.slug, day)] as never);
    // Trip 3: created on the day by the participant (participant-originated); an invitation actually sent, one only queued.
    const trip3 = await trip("Funnel Trip Three", participant, day);
    await member(trip3.id, participant, "organizer", day);
    const [invite] = await db.insert(invitations).values({ commonsId: trip3.id, provisionalPersonId: organizer, createdByPersonId: participant, recipientName: "Sent", tokenHash: randomUUID(), deliveryState: "sent", sentAt: day } as never).returning({ id: invitations.id });
    assert.ok(invite);
    const trip4 = await trip("Funnel Trip Queued", organizer, earlier);
    await member(trip4.id, organizer, "organizer", earlier);
    await db.insert(invitations).values({ commonsId: trip4.id, provisionalPersonId: participant, createdByPersonId: organizer, recipientName: "Queued", tokenHash: randomUUID(), deliveryState: "queued", queuedAt: day } as never);
    // Excluded: QA-named trip, internal account's trip, public sample trip.
    const qa = await trip("QA — funnel check", organizer, day); await member(qa.id, organizer, "organizer", day); await poll(qa.id, organizer, day);
    const internalTrip = await trip("Funnel Internal Trip", internal, day); await member(internalTrip.id, internal, "organizer", day); await poll(internalTrip.id, internal, day);
    const [sample] = await db.select({ id: commons.id, createdAt: commons.createdAt }).from(commons).where(eq(commons.slug, "cape-cod-couples-week")).limit(1);
    if (sample) { restoreSample = { id: sample.id, createdAt: sample.createdAt }; await db.update(commons).set({ createdAt: day }).where(eq(commons.id, sample.id)); }
    else { const [row] = await db.insert(commons).values({ slug: "cape-cod-couples-week", name: "Sample", timezone: "UTC", createdByPersonId: organizer, createdAt: day } as never).returning({ id: commons.id }); insertedSample = row.id; tripIds.push(row.id); }
    const sampleId = restoreSample?.id ?? insertedSample!;
    await poll(sampleId, organizer, day);

    const funnel = await loadFreeBetaFunnel(window, { databaseUrl: url, excludedEmails: [internalEmail] });
    // Only fixtures created above fall in this far-future window; the sample, QA and internal trips contribute nothing.
    assert.equal(funnel.tripsCreated, 2, "trips 2 and 3");
    assert.equal(funnel.tripsWithSharedArtifact, 2, "trip 2 by poll, trip 3 by sent invitation; trip 1's poll was earlier; queued invitation is not shared");
    assert.equal(funnel.tripsWithSharedArtifactViaPoll, 1);
    assert.equal(funnel.tripsWithSharedArtifactViaInvitation, 1);
    assert.equal(funnel.tripsWithParticipantAction, 2, "trip 1 member response/expense (once) and trip 2 link responses (once)");
    assert.equal(funnel.tripsWithOrganizerAction, 1, "trip 2 organizer's own response");
    assert.equal(funnel.tripsWithOrganizerReturn, 1, "trip 1 only; duplicate views once; same-day view of trip 2 excluded");
    assert.equal(funnel.originalOrganizerRepeatCreators, 1, "organizer created trip 1 before trip 2");
    assert.equal(funnel.participantOriginatedTrips, 1, "trip 3 by an earlier non-organizer member");
    // A later window sees nothing again: each trip or person is counted once, on its first qualifying record.
    const next = await loadFreeBetaFunnel({ startsAt: at("2031-01-11T00:00:00"), endsAt: at("2031-01-12T00:00:00") }, { databaseUrl: url, excludedEmails: [internalEmail] });
    assert.deepEqual(Object.values(next), Object.values(next).map(() => 0));
  } finally {
    if (restoreSample) await db.update(commons).set({ createdAt: restoreSample.createdAt }).where(eq(commons.id, restoreSample.id));
    await db.delete(productAnalyticsEvents).where(eq(productAnalyticsEvents.authUserId, authA));
    if (tripIds.length) await db.delete(commons).where(inArray(commons.id, tripIds.filter(id => id !== restoreSample?.id)));
    if (personIds.length) await db.delete(people).where(inArray(people.id, personIds));
    await database.close();
  }
});
