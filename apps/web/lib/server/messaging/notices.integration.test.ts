import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { commons, createDatabase, markMessagesRead, messagingMessages, people } from "@commons/database";
import { databaseTestsEnabled, testDatabaseUrl } from "../../test-support/database-harness";
import { sendMessageNotices, type NoticeDeps } from "./notices";
import type { SendEmailInput } from "@/lib/email/resend";

test("new Messages with Commons send one email notice per person, held in quiet hours, and again only after they read", { skip: !databaseTestsEnabled }, async () => {
  const url = testDatabaseUrl(), db = createDatabase(url);
  const maya = randomUUID(), sam = randomUUID(), noEmail = randomUUID(), organizer = randomUUID(), trip = randomUUID(), night = randomUUID();
  const ids = [maya, sam, noEmail, organizer];
  await db.db.insert(people).values(ids.map((id, index) => ({ id, authUserId: id, displayName: ["Maya", "Sam", "Quiet", "Casey"][index]! })));
  await db.db.insert(commons).values([
    { id: trip, slug: `notice-${trip}`, name: "Sonoma Weekend", timezone: "America/Los_Angeles", createdByPersonId: organizer },
    { id: night, slug: `notice-${night}`, name: "Night Trip", timezone: "Asia/Tokyo", createdByPersonId: organizer },
  ]);
  let clock = Date.parse("2027-03-01T19:00:00Z"); // 11:00 in Los Angeles, 04:00 in Tokyo (quiet)
  const sent: SendEmailInput[] = [];
  let failNext = false;
  const deps: NoticeDeps = {
    databaseUrl: url, now: () => new Date(clock), origin: "https://trips.example.test",
    send: async input => { if (failNext) { failNext = false; throw new Error("provider down"); } sent.push(input); return { id: "synthetic" }; },
    recipient: async ({ personId }) => ({ email: `${personId}@example.test`, emailsEnabled: personId !== noEmail }),
  };
  const message = (personId: string, commonsId: string, minutesAgo = 1) => ({ direction: "outbound" as const, provider: "web", phoneHash: `web:${personId}`, personId, commonsId, purpose: "proactive:welcome", body: "Welcome", status: "sent", sentAt: new Date(clock - minutesAgo * 60_000) });
  try {
    await db.db.insert(messagingMessages).values([message(maya, trip), message(maya, trip, 2), message(sam, trip), message(noEmail, trip), message(sam, night)]);
    let summary = await sendMessageNotices(deps);
    // Sam also has a message on a trip that's in quiet hours, so Sam waits; Maya gets one email for two messages; Quiet has emails off.
    assert.deepEqual(sent.map(item => item.to), [`${maya}@example.test`]);
    assert.equal(summary.held, 1); assert.equal(summary.skipped, 1);
    assert.match(sent[0]!.subject, /Sonoma Weekend/);
    assert.match(sent[0]!.text, /https:\/\/trips\.example\.test\/messages/);
    assert.doesNotMatch(sent[0]!.text + sent[0]!.html, /Welcome/, "the email never includes message text");

    clock += 10 * 60_000;
    await db.db.insert(messagingMessages).values(message(maya, trip));
    await sendMessageNotices(deps);
    assert.equal(sent.length, 1, "no second email before Maya reads her thread");

    await markMessagesRead(maya, new Date(clock), url);
    clock += 20 * 60_000;
    await db.db.insert(messagingMessages).values(message(maya, trip));
    failNext = true;
    summary = await sendMessageNotices(deps);
    assert.equal(summary.failed, 1, "a failed send isn't counted as told");
    summary = await sendMessageNotices(deps);
    assert.equal(sent.length, 2, "after reading, the next new message brings one more email, retried after a failure");

    clock = Date.parse("2027-03-02T02:00:00Z"); // 11:00 in Tokyo, 18:00 in Los Angeles
    await sendMessageNotices(deps);
    assert.deepEqual(sent.slice(2).map(item => item.to), [`${sam}@example.test`], "Sam's held notice goes out once quiet hours end");
  } finally {
    await db.db.delete(commons).where(inArray(commons.id, [trip, night]));
    await db.db.delete(people).where(inArray(people.id, ids));
    await db.close();
  }
});
