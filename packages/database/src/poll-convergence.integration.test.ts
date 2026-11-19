import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { createDatabase } from "./client";
import { createCommonsPoll, getCommonsPollDetail, submitPublicPollResponseByPublicId, updateCommonsPollStatus } from "./poll-repository";
import { commons, memberships, people } from "./schema";

const skip = process.env.COMMONS_RUN_DATABASE_TESTS !== "1";
async function fixture() {
  const url = process.env.TEST_DATABASE_URL!;
  const parsed = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) && parsed.pathname.endsWith("_test"), "Disposable loopback *_test database only");
  const database = createDatabase(url), event = randomUUID(), org = randomUUID(), member = randomUUID(), second = randomUUID();
  await database.db.insert(people).values([org, member, second].map((id, index) => ({ id, displayName: ["Synthetic Organizer", "Synthetic Ana", "Synthetic Ben"][index], authUserId: id })));
  await database.db.insert(commons).values({ id: event, slug: event, name: "Synthetic convergence", timezone: "UTC", createdByPersonId: org });
  await database.db.insert(memberships).values([org, member, second].map(id => ({ commonsId: event, personId: id, status: "active" as const, role: id === org ? "organizer" as const : "member" as const })));
  return { database, url, event, org, member, second, options: { databaseUrl: url, actorPersonId: org }, cleanup: async () => { await database.db.delete(commons).where(eq(commons.id, event)); await database.db.delete(people).where(inArray(people.id, [org, member, second])); await database.close(); } };
}
const places = ["Montreal", "Denver", "Miami", "Portland"].map(place => ({ id: randomUUID(), place }));
test("secret typed poll hides attribution and aggregates until closed, then exposes correct typed totals", { skip }, async () => {
  const f = await fixture();
  try {
    const optionIds = places.map(option => option.id), question = { id: randomUUID(), kind: "allocation", totalPoints: 10, prompt: "Preferences", required: true, options: places.map(option => ({ id: option.id, label: option.place, place: { name: option.place } })) };
    const poll = await createCommonsPoll(f.event, { commandId: randomUUID(), title: "Secret synthetic preference", ballotMode: "secret", audience: { personIds: [f.member], guestEmails: [] }, questions: [question] }, f.options);
    await submitPublicPollResponseByPublicId(poll.publicId, { expectedResponseUpdatedAt: null, answers: [{ questionId: question.id, optionIds: [], text: null, allocations: optionIds.map((optionId, index) => ({ optionId, points: [1, 2, 3, 4][index] })) }] }, f.url, { authUserId: f.member, email: null });
    const hidden = await getCommonsPollDetail(f.event, poll.id, f.options);
    assert.equal(hidden.resultsVisible, false); assert.deepEqual(hidden.aggregates, []); assert.equal(hidden.responses[0].answers, null);
    await updateCommonsPollStatus(f.event, poll.id, { commandId: randomUUID(), status: "closed" }, f.options);
    const closed = await getCommonsPollDetail(f.event, poll.id, f.options);
    assert.deepEqual(closed.aggregates[0].pointTotals, Object.fromEntries(optionIds.map((id, index) => [id, index + 1])));
    assert.equal(closed.responses[0].answers, null);
  } finally { await f.cleanup(); }
});
