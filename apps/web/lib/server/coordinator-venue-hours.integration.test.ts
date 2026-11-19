import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { itineraryItems } from "@commons/database";
import { eq } from "drizzle-orm";
import { databaseTestsEnabled, withCoordinatorScenario, withTestDatabase } from "./coordinator-route-harness";

test("hours questions read the canonical activity website and check-that stays on that question", { skip: !databaseTestsEnabled }, () => withCoordinatorScenario(async s => {
  const activityId = randomUUID(), website = "https://audubon.example.org/visit";
  await withTestDatabase(db => db.insert(itineraryItems).values({ id: activityId, commonsId: s.trip.eventId, title: "Randall Davey Audubon Center", timezone: "America/Denver", audience: "everyone", provenanceLabel: "Synthetic activity", sourceUrl: website, note: "Private activity note" }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const response = await originalFetch(input, init);
    if (String(input).endsWith("api.tavily.com/extract")) return Response.json({ results: [{ url: website, raw_content: "Visitor center closes at 4 PM. Grounds close at sunset." }] });
    return response;
  };
  try {
    const question = "When does the Randall Davey Audubon center close?";
    s.next.reply = `The visitor center closes at 4 PM; the grounds close at sunset. [Saved activity website](${website})`;
    let reply = await s.post(s.command({ text: question }));
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    assert.equal(reply.body.capability, "research");
    assert.match(reply.body.durableAnswer, /4 PM/);
    assert.deepEqual(s.network.tavilyCalls.map(call => call.path), ["extract"]);
    assert.deepEqual(s.network.tavilyCalls[0].body.urls, [website]);
    const thread = reply.body.thread;
    reply = await s.post(s.command({ text: "I want you to check that", target: { kind: "existing", threadId: thread.id, expectedTurnVersion: thread.turnVersion } }));
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    assert.equal(reply.body.capability, "research");
    assert.deepEqual(s.network.tavilyCalls.map(call => call.path), ["extract", "extract"]);
    assert.match(JSON.stringify(s.network.providerCalls.at(-1)?.body), /Answer only this venue-hours question/);
    assert.match(JSON.stringify(s.network.providerCalls.at(-1)?.body), /Visitor center closes at 4 PM/);
    const [activity] = await withTestDatabase(db => db.select().from(itineraryItems).where(eq(itineraryItems.id, activityId)));
    assert.equal(activity.note, "Private activity note");
    assert.equal(activity.sourceUrl, website);
  } finally { globalThis.fetch = originalFetch; }
}));
