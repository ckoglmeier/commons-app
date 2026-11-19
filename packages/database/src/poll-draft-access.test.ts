import test from "node:test";
import assert from "node:assert/strict";
import { canEditPollDraft } from "./poll-draft-access";

test("shared drafts require organizer role even for their author; private drafts stay owner-only", () => {
  const shared = { ownerPersonId: "author", organizerShared: true };
  assert.equal(canEditPollDraft(shared, "coorganizer", "organizer"), true);
  assert.equal(canEditPollDraft(shared, "author", "member"), false);
  assert.equal(canEditPollDraft(shared, "member", "member"), false);
  assert.equal(canEditPollDraft({ ...shared, organizerShared: false }, "coorganizer", "organizer"), false);
});
