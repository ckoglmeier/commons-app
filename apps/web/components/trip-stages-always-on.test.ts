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
  // The old experience's off paths are gone, so nothing passes the switches that chose between them.
  assert.doesNotMatch(app, /tripLetter[ =}]|honestLocationNotes|features=\{\{/);
  assert.doesNotMatch(read("components/home-dashboard.tsx"), /tripLetter\?|tripLetter =|if \(tripLetter\)/);
  assert.doesNotMatch(read("components/trip-map.tsx"), /honestLocationNotes/);
  assert.doesNotMatch(read("components/beta-money-wrap-up.tsx"), /features\./);
  assert.doesNotMatch(read("components/event-navigation.tsx"), /tripStage = null|tripStage !== null/);
  assert.doesNotMatch(read("app/globals.css"), /new-experience-setting/);
  assert.equal(existsSync(new URL("../app/api/v1/commons/[slug]/experience/route.ts", import.meta.url)), false, "the experience route is gone");
  assert.equal(existsSync(new URL("./new-experience-setting.tsx", import.meta.url)), false, "the switch component is gone");
  assert.doesNotMatch(read("lib/server/trip-stages.ts"), /setTripExperience|changeTripExperience/);
});
