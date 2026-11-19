import test from "node:test";
import assert from "node:assert/strict";
import { assembleCoordinatorSources } from "./coordinator-source-context";
test("source assembly retains explicit notes and attached files once, counting labels and limitations", () => {
  const source = { filename: "Trip.md", text: "Thursday dinner", limitations: ["Unverified"] };
  assert.equal(assembleCoordinatorSources("Original notes", [source]), "Original notes\n\nSource: Trip.md\nThursday dinner\nLimitations: Unverified");
  assert.equal(assembleCoordinatorSources(undefined, []), undefined);
  assert.throws(() => assembleCoordinatorSources("a".repeat(29980), [source]), /nothing was truncated/);
  assert.throws(() => assembleCoordinatorSources(undefined, [{...source,text:"a".repeat(29999)}]), /30,000/);
});
