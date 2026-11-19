import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { createDatabase } from "./client";
import { addCommonsStay } from "./pilot-repository";
import { approvePollDecision } from "./poll-decision-repository";
import { createCommonsPoll, getPublicPollByToken, submitPublicPollResponse, updateCommonsPollStatus } from "./poll-repository";
import { commons, memberships, people } from "./schema";

const run = process.env.COMMONS_RUN_DATABASE_TESTS === "1";

test("an approved place poll tells organizers which considered stay was chosen", { skip: !run }, async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  assert.ok(databaseUrl, "TEST_DATABASE_URL or DATABASE_URL is required");
  const database = createDatabase(databaseUrl);
  const personIds: string[] = [];
  let commonsId: string | undefined;
  try {
    const inserted = await database.db.insert(people).values([{ displayName: "Place Organizer", authUserId: randomUUID() }]).returning({ id: people.id });
    personIds.push(...inserted.map(person => person.id));
    const [event] = await database.db.insert(commons).values({ slug: `place-${randomUUID().slice(0, 8)}`, name: "Place Poll", startsOn: "2027-11-05",
      endsOn: "2027-11-07", timezone: "America/Los_Angeles", createdByPersonId: personIds[0]! }).returning({ id: commons.id, slug: commons.slug });
    assert.ok(event);
    commonsId = event.id;
    await database.db.insert(memberships).values([{ commonsId, personId: personIds[0]!, status: "active", role: "organizer" }]);
    const options = { databaseUrl, actorPersonId: personIds[0]! };
    const fields = { address: "", startsOn: "2027-11-05", endsOn: "2027-11-07", checkInTime: null, checkOutTime: null, status: "considering" as const,
      includedPersonIds: personIds, bookingUrl: null, pollId: null, confirmationCode: null, details: null };
    await addCommonsStay(event.slug, { ...fields, commandId: randomUUID(), name: "Lodge", roomPriceCents: 136_200 }, options);
    const snapshot = await addCommonsStay(event.slug, { ...fields, commandId: randomUUID(), name: "Valley Inn" }, options);
    const [lodge, inn] = ["Lodge", "Valley Inn"].map(name => {
      const stay = snapshot?.state.stays?.find(item => item.name === name);
      assert.ok(stay);
      return stay;
    });
    const could = randomUUID(), first = randomUUID();
    const option = (stay: typeof lodge, id: string) => ({ id, label: stay.name, description: null, exclusive: false, url: null, resource: { type: "stay" as const, id: stay.id } });
    const lodgeCould = randomUUID(), innCould = randomUUID(), lodgeFirst = randomUUID(), innFirst = randomUUID();
    const poll = await createCommonsPoll(event.slug, { commandId: randomUUID(), title: "Which place should we stay?", intro: "Pick every place that could work.", ballotMode: "transparent",
      questions: [
        { id: could, kind: "choice", prompt: "Which places could work for you?", required: true, selectionMode: "multiple", options: [option(lodge, lodgeCould), option(inn, innCould)] },
        { id: first, kind: "choice", prompt: "If you had to pick one, which would it be?", required: false, selectionMode: "single", options: [option(lodge, lodgeFirst), option(inn, innFirst)] },
      ] }, options);
    await submitPublicPollResponse(poll.shareToken, { respondentName: "Guest", answers: [{ questionId: could, optionIds: [lodgeCould, innCould] }, { questionId: first, optionIds: [lodgeFirst] }] }, databaseUrl);
    const closed = await updateCommonsPollStatus(event.slug, poll.id, { commandId: randomUUID(), status: "closed" }, options);
    const decided = await approvePollDecision(event.slug, poll.id, { commandId: randomUUID(), evidenceFingerprint: closed.evidenceFingerprint, summary: "We'll stay at the Lodge.",
      target: "record", selected: [{ questionId: first, optionId: lodgeFirst }], needResolutions: [], uncertaintyAcknowledged: true, audienceExpansionApproved: false }, options);
    assert.deepEqual(decided.decision?.selectedStayIds, [lodge.id]);
    // Respondents see the reviewed summary, never the organizer's selection detail.
    const publicView = await getPublicPollByToken(poll.shareToken, databaseUrl);
    assert.equal("selectedStayIds" in (publicView?.decision ?? {}), false);
  } finally {
    if (commonsId) await database.db.delete(commons).where(eq(commons.id, commonsId));
    if (personIds.length) await database.db.delete(people).where(inArray(people.id, personIds));
    await database.close();
  }
});
