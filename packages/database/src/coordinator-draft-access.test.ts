import test from "node:test";
import assert from "node:assert/strict";
import { canEditCoordinatorDraft } from "./coordinator-draft-access";

test("shared drafts require organizer role even for their author; private drafts stay owner-only", () => {
  const shared = { ownerPersonId: "author", organizerShared: true };
  assert.equal(canEditCoordinatorDraft(shared, "coorganizer", "organizer"), true);
  assert.equal(canEditCoordinatorDraft(shared, "author", "member"), false);
  assert.equal(canEditCoordinatorDraft(shared, "member", "member"), false);
  assert.equal(canEditCoordinatorDraft({ ...shared, organizerShared: false }, "coorganizer", "organizer"), false);
});
