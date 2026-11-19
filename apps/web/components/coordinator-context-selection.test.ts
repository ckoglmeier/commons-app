import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("new server-confirmed artifacts are not discarded against a stale render", async () => {
  const source = await readFile(new URL("./use-coordinator-context.ts", import.meta.url), "utf8");
  assert.match(source, /return validWorkspaceContext\(stored \?\? fallback, thread\)/);
  const select = source.split("const select = useCallback")[1];
  assert.doesNotMatch(select, /validWorkspaceContext\(value, thread\)/);
  assert.match(select, /memory.set\(key, value\)/);
});
