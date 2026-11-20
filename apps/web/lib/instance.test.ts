import assert from "node:assert/strict";
import test from "node:test";
import policies from "./legal/policies.json";
import { fillPolicyText, instanceSettings } from "./instance";

const render = (id: "terms" | "privacy", env: Record<string, string>) => {
  const settings = instanceSettings(env);
  return (policies[id].sections as string[][]).map(([, text]) => fillPolicyText(text, settings)).join("\n");
};

test("legal text reads cleanly with no owner name set", () => {
  const settings = instanceSettings({});
  assert.equal(settings.ownerNamed, false);
  assert.equal(settings.ownerName, "The person who set up this copy");
  const terms = render("terms", {});
  assert.match(terms, /This copy of Commons, an open source group trip planner, is run by the person who set up this copy\./);
  assert.match(terms, /Contact the person who set up this copy through the trip organizer who invited you\./);
  const privacy = render("privacy", {});
  assert.match(privacy, /This copy of Commons is run by the person who set up this copy, who is responsible for the personal information it holds\./);
  assert.doesNotMatch(terms + privacy, /runs this copy|Contact The |, The person|of The person|by The person/);
});

test("legal text uses a set owner name and contact email as written", () => {
  const env = { COMMONS_INSTANCE_OWNER_NAME: "Casey Rivera", COMMONS_INSTANCE_CONTACT_EMAIL: "casey@example.com" };
  assert.equal(instanceSettings(env).ownerNamed, true);
  const terms = render("terms", env);
  assert.match(terms, /is run by Casey Rivera\./);
  assert.match(terms, /Contact Casey Rivera at casey@example\.com\./);
  assert.match(render("privacy", env), /is run by Casey Rivera, who is responsible/);
});
