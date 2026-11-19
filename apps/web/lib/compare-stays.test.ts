import test from "node:test";
import assert from "node:assert/strict";
import { compareStaysSnapshot, compareStaysProgram, recoverStayComparisonDraft, compareStaysPollPath } from "./compare-stays";
import { compareStayFixtures } from "./test-support/compare-stays-fixture";
import { compareStaysEnabled, readCommonsRuntimeEnvironment } from "./server/runtime-environment";
const commons = { id: "10000000-0000-4000-8000-000000000001", timezone: "Europe/London" };
const snapshot = () => compareStaysSnapshot(commons, compareStayFixtures("person"), []);

test("pilot is off by default and only an explicit server flag enables it", () => {
  assert.equal(readCommonsRuntimeEnvironment({ NODE_ENV: "test" }).COMMONS_COMPARE_STAYS_ENABLED, "false");
  for (const value of [undefined, "false", "TRUE", true, 1]) assert.equal(compareStaysEnabled({COMMONS_COMPARE_STAYS_ENABLED:value}), false);
  assert.equal(compareStaysEnabled({COMMONS_COMPARE_STAYS_ENABLED:"true"}), true);
});
test("comparison includes only considered stays and explicitly projects permitted facts", () => {
  const stays = compareStayFixtures("person");
  const result = compareStaysSnapshot(commons, [...stays, {...stays[0], id:"confirmed", status:"confirmed"}], []);
  assert.equal(result.options.length,3);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE-CODE|confirmationDocument|person"/);
  assert.match(result.options[0].price.join(" "), /960.*total.*estimate/);
  assert.match(result.options[1].price.join(" "), /per room.*Rooms needed not set/);
  assert.doesNotMatch(result.options[1].price.join(" "), /group total|per person/);
  assert.deepEqual(result.options[2].price,[]);
  assert.equal(result.options[2].sourceUrl,null);
  assert.match(result.options[2].unknowns.join(" "), /Price not recorded/);
  assert.match(result.options[0].distance,/Not on the map/);
});
test("OpenUI receives IDs and layout only, with all data strings escaped", () => {
  const result = snapshot(), program = compareStaysProgram(result,"price");
  assert.match(program,/root = StayComparison/);
  assert.doesNotMatch(program,/960|540|Old Town|PRIVATE|https|Mutation|Query/);
  result.options[0].id = 'x")\nroot = Mutation("send")';
  assert.equal(compareStaysProgram(result,"price").split("\n").length,4);
});
test("shortlist recovery refuses corrupt state and keeps only valid unique IDs", () => {
  const result=snapshot();
  assert.deepEqual(recoverStayComparisonDraft("broken",result).selectedIds,[]);
  assert.deepEqual(recoverStayComparisonDraft(JSON.stringify({revision:result.revision,focus:"overview",selectedIds:[result.options[0].id,result.options[0].id,"other-trip"]}),result).selectedIds,[result.options[0].id]);
});
test("review handoff requires two current options and never applies a stay", () => {
  const result=snapshot(), draft={revision:result.revision,focus:"overview" as const,selectedIds:[result.options[0].id]};
  assert.equal(compareStaysPollPath(result,draft),null);
  draft.selectedIds.push(result.options[1].id);
  const path=compareStaysPollPath(result,draft)!;
  assert.match(path,/\/polls\/new\?stayIds=/);
  assert.doesNotMatch(path,/apply|publish|confirm/);
  assert.equal(compareStaysPollPath({...result,revision:"changed"},draft),null);
  assert.equal(compareStaysPollPath({...result,options:result.options.slice(1)},draft),null);
});
test("a price, date or room change invalidates recovery; unprojected code changes do not", () => {
  const stays=compareStayFixtures("person"), before=compareStaysSnapshot(commons,stays,[]);
  const draft=JSON.stringify({revision:before.revision,focus:"price",selectedIds:before.options.slice(0,2).map(o=>o.id)});
  stays[1].roomCount=2;
  const after=compareStaysSnapshot(commons,stays,[]), recovered=recoverStayComparisonDraft(draft,after);
  assert.notEqual(after.revision,before.revision);
  assert.equal(compareStaysPollPath(after,recovered),null);
  stays[1].roomCount=undefined; stays[0].confirmationCode="CHANGED-PRIVATE";
  assert.equal(compareStaysSnapshot(commons,stays,[]).revision,before.revision);
});
