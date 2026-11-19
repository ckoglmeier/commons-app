import assert from "node:assert/strict";
import test from "node:test";
import { createImportPreviewHandler } from "./preview-route";
import { UploadTooLargeError } from "./read-bounded-form-data";

const request = new Request("https://commons.test/api/v1/imports/preview", { method: "POST" });

test("import preview requires authentication before reading the request", async () => {
  let parsed = false;
  const handler = createImportPreviewHandler({
    authenticate: async () => false,
    readForm: async () => {
      parsed = true;
      return new FormData();
    },
  });

  const response = await handler(request);
  assert.equal(response.status, 401);
  assert.equal(parsed, false);
});

test("import preview reports an oversized authenticated upload", async () => {
  const handler = createImportPreviewHandler({
    authenticate: async () => true,
    readForm: async () => { throw new UploadTooLargeError(); },
  });

  const response = await handler(request);
  assert.equal(response.status, 413);
});
