import { strict as assert } from "node:assert";
import test from "node:test";
import { writingSmokeCases, writingSmokeChecks } from "../writing-smoke-contract";

test("writing smoke briefs are fixed and de-identified", () => {
  assert.equal(writingSmokeCases.length, 4);
  assert.ok(writingSmokeCases.every(([, prompt]) => !/[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/i.test(prompt)));
  assert.ok(writingSmokeCases.some(([title]) => title === "First question"));
});

test("writing smoke checks preserve required facts and flag unsupported action claims", () => {
  const valid = writingSmokeChecks("October 10–12 or October 17–19. This is not a booking or commitment.", "First question");
  assert.ok(valid.every(check => !check.startsWith("Needs review")));
  const invalid = writingSmokeChecks("Commons sent the calendar invite.", "First question");
  assert.ok(invalid.some(check => check.includes("unsupported action claim")));
});
