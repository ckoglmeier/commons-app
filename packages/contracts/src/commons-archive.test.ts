import assert from "node:assert/strict";
import test from "node:test";
import { UpdateCommonsArchiveRequestSchema } from "./commons";

test("archive requests require an idempotency key and explicit archive state", () => {
  assert.deepEqual(UpdateCommonsArchiveRequestSchema.parse({
    commandId: "archive-command",
    archived: true,
  }), {
    commandId: "archive-command",
    archived: true,
  });
  assert.equal(UpdateCommonsArchiveRequestSchema.safeParse({ commandId: "archive-command" }).success, false);
});
