import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { formatPollSchedule, type PollAvailability, type PollSchedule } from "@commons/contracts";
import { createDatabase } from "./client";
import { listCommonsPollDrafts, saveCommonsPollDraft } from "./poll-draft-repository";
import { createCommonsPoll, getCommonsPollDetail, getPublicPollByPublicId, submitPublicPollResponseByPublicId, updateCommonsPollStatus } from "./poll-repository";
import { commons, memberships, people } from "./schema";

for (const mode of ["days", "ranges", "times"] as const) {
  test(`${mode} availability: private drafts, persistence, audience, response and secret results`, { skip: process.env.COMMONS_RUN_DATABASE_TESTS !== "1" }, async () => {
    const url = process.env.TEST_DATABASE_URL!;
    assert.ok(url);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname), "Disposable local database only");
    const database = createDatabase(url);
    const event = randomUUID(), org = randomUUID(), member = randomUUID();
    const options = { databaseUrl: url, actorPersonId: org };
    try {
      await database.db.insert(people).values([{ id: org, displayName: "QA organizer", authUserId: org }, { id: member, displayName: "QA participant", authUserId: member }]);
      await database.db.insert(commons).values({ id: event, slug: event, name: "Availability QA", createdByPersonId: org, timezone: "America/Denver" });
      await database.db.insert(memberships).values([{ commonsId: event, personId: org, role: "organizer", status: "active" }, { commonsId: event, personId: member, role: "member", status: "active" }]);
      const availability: PollAvailability = { mode, timezone: "America/Denver" };
      const schedule: PollSchedule = { startsOn: "2027-10-10", endsOn: mode === "ranges" ? "2027-10-12" : "2027-10-10", startTime: mode === "times" ? "09:30" : "", endTime: mode === "times" ? "11:00" : "" };
      const option = { id: randomUUID(), label: formatPollSchedule(schedule, availability), schedule, exclusive: false };
      const none = { id: randomUUID(), label: "None of these works", exclusive: true };
      const question = { id: randomUUID(), kind: "choice", prompt: "Which days work?", required: true, selectionMode: "multiple", availability, options: [option, none] };
      const data = { title: "Choose dates", intro: null, ballotMode: mode === "times" ? "secret" : "transparent", audience: { personIds: [member], guestEmails: [] }, questions: [question] };
      const partial = { ...data, questions: [{ ...question, options: [{ ...option, label: "Choose a date", schedule: { ...schedule, startsOn: "" } }, none] }] };
      const draft = await saveCommonsPollDraft(event, { id: randomUUID(), commandId: randomUUID(), expectedVersion: 0, data: partial }, options);
      assert.equal((await listCommonsPollDrafts(event, { ...options, actorPersonId: member })).length, 0);
      await assert.rejects(createCommonsPoll(event, { ...partial, commandId: randomUUID(), draftId: draft.id, draftVersion: draft.version }, options));
      const saved = await saveCommonsPollDraft(event, { id: draft.id, commandId: randomUUID(), expectedVersion: draft.version, data }, options);
      const reloaded = (await listCommonsPollDrafts(event, options)).find(item => item.id === draft.id)!;
      assert.deepEqual(reloaded.data.questions[0].kind === "choice" && reloaded.data.questions[0].availability, availability);
      const publish = { ...saved.data, commandId: randomUUID(), draftId: saved.id, draftVersion: saved.version };
      const poll = await createCommonsPoll(event, publish, options);
      assert.equal((await createCommonsPoll(event, publish, options)).id, poll.id, "retry does not duplicate");
      assert.deepEqual(poll.questions[0].kind === "choice" && poll.questions[0].options[0].schedule, schedule);
      const viewer = { authUserId: member, email: null };
      const publicPoll = await getPublicPollByPublicId(poll.publicId, url, viewer);
      assert.ok(publicPoll);
      assert.deepEqual(publicPoll.questions, poll.questions);
      const answer = { respondentName: "QA participant", expectedResponseUpdatedAt: null, answers: [{ questionId: question.id, optionIds: [option.id], text: null }] };
      await submitPublicPollResponseByPublicId(poll.publicId, answer, url, viewer);
      const results = await getCommonsPollDetail(event, poll.id, options);
      assert.equal(results.responseCount, 1);
      if (mode === "times") {
        assert.equal(results.resultsVisible, false);
        assert.ok(results.responses.every(response => response.answers === null), "secret choices are never attributed");
        await updateCommonsPollStatus(event, poll.id, { commandId: randomUUID(), status: "closed" }, options);
      }
      const visible = await getCommonsPollDetail(event, poll.id, options);
      assert.equal(visible.aggregates[0].optionCounts[option.id], 1);
      const trip = (await database.db.select().from(commons).where(eq(commons.id, event)))[0];
      assert.equal(trip.startsOn, null); assert.equal(trip.endsOn, null, "availability never mutates event dates");
    } finally {
      await database.db.delete(commons).where(eq(commons.id, event));
      await database.db.delete(people).where(inArray(people.id, [org, member]));
      await database.close();
    }
  });
}
