import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("every trip uses the two stages; there is no New experience switch", () => {
  const page = read("app/c/[slug]/page.tsx");
  assert.doesNotMatch(page, /newExperience|tripStagesOn|betaCompletion|tripLetterEnabled|betaMapEnabled/);
  const app = read("components/commons-app.tsx");
  assert.doesNotMatch(app, /NewExperienceSetting|new-experience-setting|tripStagesOn|tripLetterEnabled|betaMapEnabled|betaCompletion/);
  assert.match(app, /const tripStage = initialSnapshot\.commons\.stage \?\? "going";/);
  assert.match(app, /\{\.\.\.tripHome\} tripLetter decidingStage/);
  assert.match(app, /honestLocationNotes openStay=\{id => openItem\("stay", id\)\}/);
  assert.match(app, /features=\{\{ paymentReports: true, closure: true, recap: true, successor: true \}\}/);
  assert.equal(existsSync(new URL("../app/api/v1/commons/[slug]/experience/route.ts", import.meta.url)), false, "the experience route is gone");
  assert.equal(existsSync(new URL("./new-experience-setting.tsx", import.meta.url)), false, "the switch component is gone");
  assert.doesNotMatch(read("lib/server/trip-stages.ts"), /setTripExperience|changeTripExperience/);
});
