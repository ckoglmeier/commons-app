import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("confirmation uploads are bounded, private, and reviewed before commit", async () => {
  const [previewRoute, downloadRoute, adminStorage, migration] = await Promise.all([
    readFile(new URL("../app/api/v1/commons/[slug]/confirmations/preview/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/v1/commons/[slug]/confirmations/[resourceType]/[resourceId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("./supabase/admin.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../packages/database/migrations/0041_loving_killmonger.sql", import.meta.url), "utf8"),
  ]);
  assert.match(previewRoute, /readBoundedFormData/);
  assert.match(previewRoute, /identifyConfirmationFile/);
  assert.match(previewRoute, /loadCommonsSnapshot/);
  assert.match(previewRoute, /expectedKind/);
  assert.match(previewRoute, /No readable text was found\. Add the booking details below\./);
  assert.doesNotMatch(previewRoute, /No readable text was found in that PDF\. Your trip is unchanged/);
  assert.match(adminStorage, /commons-confirmations/);
  assert.match(downloadRoute, /downloadCommonsConfirmationAsset/);
  assert.match(downloadRoute, /private, no-store/);
  assert.match(migration, /confirmation_documents_select_owner/);
  assert.doesNotMatch(migration, /on public\.confirmation_documents for (insert|update|delete)/i);
});
