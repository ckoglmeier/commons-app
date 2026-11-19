import assert from "node:assert/strict";
import test from "node:test";
import {
  readBoundedFormData,
  UploadTooLargeError,
} from "./read-bounded-form-data";

test("rejects a declared oversized import before reading its body", async () => {
  let bodyRead = false;
  const request = {
    headers: new Headers({
      "content-length": "101",
      "content-type": "multipart/form-data; boundary=test",
    }),
    get body() {
      bodyRead = true;
      throw new Error("Body should not be read.");
    },
  } as unknown as Request;

  await assert.rejects(readBoundedFormData(request, 100), UploadTooLargeError);
  assert.equal(bodyRead, false);
});

test("stops a chunked import once the byte limit is crossed", async () => {
  const request = new Request("https://commons.test/api/v1/imports/preview", {
    method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=test" },
    body: new Blob(["123456"]),
  });

  await assert.rejects(readBoundedFormData(request, 5), UploadTooLargeError);
});

test("parses a form that stays within the request limit", async () => {
  const source = new FormData();
  source.set("text", "Dinner at 7:30");
  const request = new Request("https://commons.test/api/v1/imports/preview", {
    method: "POST",
    body: source,
  });

  const form = await readBoundedFormData(request, 1_024);
  assert.equal(form.get("text"), "Dinner at 7:30");
});
