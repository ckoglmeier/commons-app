import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("private trip fixtures stay out of tracked application source", () => {
  const removedFixturePaths = [
    new URL("./sea-island-fixture.ts", import.meta.url),
    new URL("./hawaiifest-fixture.ts", import.meta.url),
    new URL("../../../packages/database/src/sea-island-data.ts", import.meta.url),
    new URL("../../../packages/database/src/hawaiifest-data.ts", import.meta.url),
    new URL("../../../packages/database/src/seed-sea-island.ts", import.meta.url),
    new URL("../../../packages/database/src/seed-hawaiifest.ts", import.meta.url),
  ];
  for (const path of removedFixturePaths) {
    assert.equal(existsSync(fileURLToPath(path)), false, fileURLToPath(path));
  }

  const serverBoundary = readFileSync(
    new URL("./server/commons.ts", import.meta.url),
    "utf8",
  );
  const clientBoundary = readFileSync(
    new URL("../components/commons-app.tsx", import.meta.url),
    "utf8",
  );
  for (const source of [serverBoundary, clientBoundary]) {
    assert.doesNotMatch(source, /sea-island-2026|hawaiifest-2k25/i);
    assert.doesNotMatch(source, /applyFixtureCopy|fixtureCopy/);
  }
});
