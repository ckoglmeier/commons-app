import {
  DeleteMomentRequestSchema,
  UpdateMomentRequestSchema,
} from "@commons/contracts";
import assert from "node:assert/strict";
import test from "node:test";

test("moves a photo to a trip day without requiring a plan", () => {
  const command = UpdateMomentRequestSchema.parse({
    commandId: "move-photo-1",
    caption: "First morning",
    occurredOn: "2027-07-19",
    itineraryItemId: null,
  });

  assert.equal(command.occurredOn, "2027-07-19");
  assert.equal(command.itineraryItemId, null);
});

test("allows a photo to return to Unsorted", () => {
  const command = UpdateMomentRequestSchema.parse({
    commandId: "unsort-photo-1",
    caption: "Sunset",
    occurredOn: null,
    itineraryItemId: null,
  });

  assert.equal(command.occurredOn, null);
});

test("photo edits and deletes require valid input", () => {
  assert.throws(() => UpdateMomentRequestSchema.parse({
    commandId: "edit-photo-1",
    caption: "",
    occurredOn: "today",
    itineraryItemId: null,
  }));
  assert.throws(() => DeleteMomentRequestSchema.parse({ commandId: "" }));
});
