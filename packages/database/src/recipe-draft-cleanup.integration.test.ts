import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { createDatabase } from "./client";
import { commons, memberships, people, pollDrafts } from "./schema";
import { createCommonsPoll } from "./poll-repository";
import { getRecipeRun, listRecipeRuns, publishRecipeRound, reviseRecipeRound, saveRecipeInputs, setRecipeDraftArchived, startRecipeRun } from "./recipe-run-repository";

test("draft cleanup is authorized, versioned, recoverable and cannot remove shared history", { skip: process.env.COMMONS_RUN_DATABASE_TESTS !== "1" }, async () => {
  const url = process.env.TEST_DATABASE_URL!;
  assert.equal(new URL(url).hostname, "127.0.0.1"); assert.ok(new URL(url).pathname.endsWith("_test"));
  const database = createDatabase(url), db = database.db, event = randomUUID(), other = randomUUID(), org = randomUUID(), member = randomUUID();
  const as = (actorPersonId = org) => ({ databaseUrl: url, actorPersonId });
  try {
    await db.insert(people).values([{ id: org, displayName: "Cleanup organizer", authUserId: org }, { id: member, displayName: "Cleanup traveler", authUserId: member }]);
    await db.insert(commons).values([event, other].map(id => ({ id, slug: id, name: "Synthetic cleanup", createdByPersonId: org, timezone: "America/Denver" })));
    await db.insert(memberships).values([{ commonsId: event, personId: org, role: "organizer", status: "active" }, { commonsId: other, personId: org, role: "organizer", status: "active" }, { commonsId: event, personId: member, role: "member", status: "active" }]);
    const runId = randomUUID();
    await startRecipeRun(event, { commandId: randomUUID(), runId, draftId: randomUUID(), recipe: "food_preferences" }, as());
    let run = await getRecipeRun(event, runId, as());
    const deletion = { commandId: randomUUID(), expectedDraftVersion: run.draft.version, archived: true };
    await assert.rejects(setRecipeDraftArchived(event, runId, deletion, as(member)));
    await assert.rejects(setRecipeDraftArchived(other, runId, deletion, as()));
    await assert.rejects(setRecipeDraftArchived(event, runId, { ...deletion, expectedDraftVersion: 99 }, as()));
    const receipt = await setRecipeDraftArchived(event, runId, deletion, as());
    assert.deepEqual(await setRecipeDraftArchived(event, runId, deletion, as()), receipt);
    assert.equal((await listRecipeRuns(event, as())).length, 0);
    assert.equal((await listRecipeRuns(event, as(), true))[0].archived, true);
    run = await getRecipeRun(event, runId, as()); assert.equal(run.draft.archived, true);
    await assert.rejects(saveRecipeInputs(event, runId, { commandId: randomUUID(), expectedDraftVersion: run.draft.version, title: "Wrong" }, as()));
    await assert.rejects(publishRecipeRound(event, runId, { commandId: randomUUID(), expectedDraftVersion: run.draft.version, access: "link" }, as()));
    const [archivedDraft] = await db.select().from(pollDrafts).where(eq(pollDrafts.id, run.draft.id));
    await assert.rejects(createCommonsPoll(event, { ...archivedDraft.data, commandId: randomUUID(), draftId: archivedDraft.id,
      draftVersion: archivedDraft.version, publicationApproval: { approved: true, access: "link" } }, as()), /deleted/, "Generic publication must also reject archived drafts");
    await setRecipeDraftArchived(event, runId, { commandId: randomUUID(), expectedDraftVersion: receipt.draftVersion, archived: false }, as());
    run = await getRecipeRun(event, runId, as()); assert.equal(run.draft.archived, false); assert.equal(run.title, "Food preferences");
    await assert.rejects(setRecipeDraftArchived(event, runId, { ...deletion, commandId: randomUUID() }, as()), "Old tab cannot delete restored version");
    const published = await publishRecipeRound(event, runId, { commandId: randomUUID(), expectedDraftVersion: run.draft.version, access: "link" }, as());
    run = await getRecipeRun(event, runId, as());
    await assert.rejects(setRecipeDraftArchived(event, runId, { commandId: randomUUID(), expectedDraftVersion: run.draft.version, archived: true }, as()));
    await reviseRecipeRound(event, runId, { commandId: randomUUID(), expectedDraftVersion: run.draft.version }, as());
    run = await getRecipeRun(event, runId, as());
    await assert.rejects(setRecipeDraftArchived(event, runId, { commandId: randomUUID(), expectedDraftVersion: run.draft.version, archived: true }, as()));
    assert.equal(run.history[0].pollId, published.pollId);
  } finally { await db.delete(commons).where(inArray(commons.id, [event, other])); await db.delete(people).where(inArray(people.id, [org, member])); await database.close(); }
});
