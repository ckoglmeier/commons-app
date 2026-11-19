import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { createDatabase } from "./client";
import { addCommonsExpense, addCommonsStay, deleteCommonsStay, getCommonsSnapshot, updateCommonsStay } from "./pilot-repository";
import { createCommonsPoll } from "./poll-repository";
import { commons, memberships, people } from "./schema";

const run = process.env.COMMONS_RUN_DATABASE_TESTS === "1";

test("organizers can add, update, and remove a first-class stay", { skip: !run }, async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  assert.ok(databaseUrl, "TEST_DATABASE_URL or DATABASE_URL is required");
  const database = createDatabase(databaseUrl);
  const personIds: string[] = [];
  let commonsId: string | undefined;
  try {
    const insertedPeople = await database.db.insert(people).values([
      { displayName: "Stay Organizer", authUserId: randomUUID() },
      { displayName: "Stay Traveler", authUserId: randomUUID() },
    ]).returning({ id: people.id });
    personIds.push(...insertedPeople.map((person) => person.id));
    const [event] = await database.db.insert(commons).values({
      slug: `stay-${randomUUID().slice(0, 8)}`,
      name: "Stay Test",
      startsOn: "2027-07-01",
      endsOn: "2027-07-04",
      timezone: "America/Denver",
      createdByPersonId: personIds[0]!,
    }).returning({ id: commons.id, slug: commons.slug });
    assert.ok(event);
    commonsId = event.id;
    await database.db.insert(memberships).values([
      { commonsId, personId: personIds[0]!, status: "active", role: "organizer" },
      { commonsId, personId: personIds[1]!, status: "active", role: "member" },
    ]);
    const options = { databaseUrl, actorPersonId: personIds[0]! };
    const added = await addCommonsStay(event.slug, {
      commandId: randomUUID(),
      name: "Option A",
      address: "1 Main Street, Denver, CO",
      startsOn: "2027-07-01",
      endsOn: "2027-07-04",
      checkInTime: "16:00",
      checkOutTime: "11:00",
      status: "considering",
      includedPersonIds: personIds,
      bookingUrl: "https://example.com/option-a",
      pollId: null,
      confirmationCode: null,
      details: "Free cancellation until June 1.",
    }, options);
    const stay = added?.state.stays?.[0];
    assert.ok(stay);
    assert.equal(stay.bookingUrl, "https://example.com/option-a");
    assert.deepEqual(new Set(stay.includedPersonIds), new Set(personIds));

    const withSecondOption = await addCommonsStay(event.slug, {
      commandId: randomUUID(),
      name: "Option B",
      address: "2 Main Street, Denver, CO",
      startsOn: "2027-07-01",
      endsOn: "2027-07-04",
      checkInTime: null,
      checkOutTime: null,
      status: "considering",
      includedPersonIds: personIds,
      bookingUrl: "https://example.com/option-b",
      pollId: null,
      confirmationCode: null,
      details: null,
    }, options);
    const secondStay = withSecondOption?.state.stays?.find((item) => item.name === "Option B");
    assert.ok(secondStay);
    const poll = await createCommonsPoll(event.slug, {
      commandId: randomUUID(),
      title: "Stay options",
      intro: "Choose one.",
      ballotMode: "transparent",
      questions: [{
        id: randomUUID(),
        kind: "choice",
        prompt: "Where should we stay?",
        required: true,
        selectionMode: "single",
        options: [stay, secondStay].map((item) => ({
          id: item.id,
          label: item.name,
          description: item.address,
          exclusive: false,
          url: item.bookingUrl ?? null,
          resource: { type: "stay", id: item.id },
        })),
      }],
    }, options);
    const linked = await getCommonsSnapshot(event.slug, options);
    assert.equal(linked?.state.stays?.find((item) => item.id === stay.id)?.pollId, poll.id);
    assert.equal(linked?.state.stays?.find((item) => item.id === secondStay.id)?.pollId, poll.id);

    const updated = await updateCommonsStay(event.slug, stay.id, {
      commandId: randomUUID(),
      name: "Option A",
      address: "1 Main Street, Denver, CO",
      startsOn: "2027-07-01",
      endsOn: "2027-07-04",
      checkInTime: "16:00",
      checkOutTime: "11:00",
      status: "confirmed",
      includedPersonIds: personIds,
      bookingUrl: "https://example.com/option-a",
      pollId: null,
      confirmationCode: "BOOKED-123",
      totalCents: 245_000,
      currency: "USD",
      costSource: "confirmation",
      includesTaxesAndFees: true,
      details: "Two rooms.",
      confirmationDocument: {
        storagePath: `${event.slug}/${personIds[0]}/${randomUUID()}.pdf`,
        fileName: "option-a-confirmation.pdf",
        mimeType: "application/pdf",
      },
    }, options);
    assert.equal(updated?.state.stays?.[0]?.status, "confirmed");
    assert.equal(updated?.state.stays?.[0]?.confirmationCode, "BOOKED-123");
    assert.equal(updated?.state.stays?.[0]?.totalCents, 245_000);
    assert.equal(updated?.state.stays?.[0]?.costSource, "confirmation");
    assert.equal(updated?.state.stays?.[0]?.includesTaxesAndFees, true);
    assert.equal(updated?.state.stays?.[0]?.confirmationDocumentFileName, "option-a-confirmation.pdf");
    const otherTravelerSnapshot = await getCommonsSnapshot(event.slug, { databaseUrl, actorPersonId: personIds[1]! });
    assert.equal(otherTravelerSnapshot?.state.stays?.[0]?.confirmationDocumentFileName, undefined);
    assert.equal(otherTravelerSnapshot?.state.stays?.[0]?.confirmationDocumentUrl, undefined);

    const withExpense = await addCommonsExpense(event.slug, {
      commandId: randomUUID(),
      title: "Option A lodging",
      amountCents: 245_000,
      paidByPersonId: personIds[0],
      occurredOn: "2027-07-01",
      category: "Lodging",
      itineraryItemId: null,
      stayId: stay.id,
      splitMethod: "equal",
      balanceMode: "allocated",
      confirmationCode: "BOOKED-123",
      shares: [
        { personId: personIds[0], amountCents: 122_500 },
        { personId: personIds[1], amountCents: 122_500 },
      ],
    }, options);
    assert.equal(withExpense?.state.expenses[0]?.stayId, stay.id);
    assert.equal(withExpense?.state.expenses[0]?.amountCents, 245_000);
    assert.equal(withExpense?.state.expenses[0]?.receiptStatus, "attached");
    assert.equal(withExpense?.state.expenses[0]?.receiptFileName, "option-a-confirmation.pdf");

    const removed = await deleteCommonsStay(event.slug, stay.id, { commandId: randomUUID() }, options);
    assert.equal(removed?.state.stays?.length, 1);
    assert.equal(removed?.state.stays?.[0]?.id, secondStay.id);
  } finally {
    if (commonsId) await database.db.delete(commons).where(eq(commons.id, commonsId));
    if (personIds.length) await database.db.delete(people).where(inArray(people.id, personIds));
    await database.close();
  }
});
