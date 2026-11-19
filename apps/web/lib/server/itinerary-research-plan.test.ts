import test from "node:test";
import assert from "node:assert/strict";
import type { TripContextSnapshot } from "@commons/contracts";
import { itineraryResearchPlan } from "./itinerary-research-plan";
const context = { trip: { value: { name: "Private trip", destination: "Sonoma" } }, travelers: [{ value: { name: "Private Person" } }], stays: [{ value: { name: "Private Lodge", address: "123 Private Road" } }], plans: [], foodPreferences: [] } as unknown as TripContextSnapshot;
test("bounded query plan preserves public party/day scope, covers transport, and never appends saved private context", () => {
 const plan = itineraryResearchPlan("Sonoma wineries and transport for nine on Friday", context);
 assert.equal(plan.length, 3);
 for (const query of plan) { assert.match(query, /nine on Friday/); assert.ok(query.length <= 500); assert.doesNotMatch(query, /Private|123/); }
 assert.match(plan[0], /group size/); assert.match(plan[1], /opening days/); assert.match(plan[2], /transport passenger/);
 assert.deepEqual(itineraryResearchPlan("Private Person Private Lodge", context), []);
 assert.deepEqual(itineraryResearchPlan("x".repeat(490), context), [], "no silent removal of query constraints to fit more searches");
});
test("follow-up search plan targets only missing material rule categories", () => {
 const plan = itineraryResearchPlan("Sonoma wineries for nine on Friday", context, ["eligible_day"]);
 assert.equal(plan.length, 1); assert.match(plan[0], /opening days/);
 assert.deepEqual(itineraryResearchPlan("Sonoma wineries", context, []), []);
});


test("candidate-first searches cover each explicitly requested winery without repeating the other suppliers", () => {
 const query = "Sonoma winery group rules for nine on Friday at Schramsberg, Flowers, and DaVero";
 for (const hints of [[], ["Schramsberg Vineyards", "Flowers Vineyards & Winery", "DaVero Farms & Winery", "PRIVATE_UNSUPPLIED_LODGE"]]) {
  const plan = itineraryResearchPlan(query, context, undefined, hints);
  assert.equal(plan.length, 3);
  for (const [index, name] of ["Schramsberg", "Flowers", "DaVero"].entries()) {
   assert.ok(plan[index].startsWith(name + " "));
   for (const other of ["Schramsberg", "Flowers", "DaVero"].filter(value => value !== name)) assert.ok(!plan[index].includes(other));
   assert.match(plan[index], /Sonoma winery group rules for nine on Friday/);
   assert.doesNotMatch(plan[index], /PRIVATE_|Vineyards|Farms/);
  }
 }
});
test("Santa Fe plain option hints retain public names, Saturday scope and admission without copying saved labels", () => {
 const plan = itineraryResearchPlan("Santa Fe Saturday admission for six at Meow Wolf, O'Keeffe Museum, and Canyon Road galleries", context, undefined,
  ["Meow Wolf", "O'Keeffe Museum", "Canyon Road galleries"]);
 assert.equal(plan.length, 3);
 assert.match(plan[0], /^Meow Wolf /); assert.match(plan[1], /^O'Keeffe Museum /); assert.match(plan[2], /^Canyon Road galleries /);
 for (const query of plan) { assert.match(query, /Santa Fe Saturday admission for six/); assert.match(query, /official/); }
});
test("focused recovery uses supplied names only, preserves logical constraints and keeps missing-category scope", () => {
 const plan = itineraryResearchPlan("Flowers and DaVero tours for nine on Friday or Monday in Sonoma", context, ["eligible_day"],
  ["Flowers PRIVATE_SUFFIX", "DaVero PRIVATE_SUFFIX"]);
 assert.equal(plan.length, 2);
 for (const query of plan) { assert.match(query, /Friday or Monday/); assert.match(query, /nine/); assert.match(query, /opening days/); assert.doesNotMatch(query, /PRIVATE_|published rates/); }
 assert.deepEqual(itineraryResearchPlan("Flowers with Private Person", context, undefined, ["Flowers"]), []);
 assert.equal(itineraryResearchPlan("Flowerside tours in Sonoma", context, undefined, ["Flowers"]).length, 3, "partial words cannot masquerade as a requested venue");
});


test("candidate discovery is concise and gallery policy is not replaced by tour shopping", () => {
 const plan = itineraryResearchPlan("Saturday visits for six at Meow Wolf, O'Keeffe Museum, and Canyon Road galleries in Santa Fe", context);
 assert.equal(plan.length,3);
 for (const query of plan) { assert.ok(query.length<220); assert.match(query,/Saturday visits for six/); }
 assert.match(plan[2],/individual gallery websites visiting hours/);
 assert.doesNotMatch(plan[0],/individual gallery/);
});


test("museum discovery explicitly seeks ordinary admission rather than stopping at hours", () => {
 const queries=itineraryResearchPlan("Santa Fe Saturday visits for six at Meow Wolf, O'Keeffe Museum, and Canyon Road galleries",context);
 assert.match(queries[1],/tickets admission prices ordinary adult general admission/);
 assert.match(queries[1],/Saturday visits for six/);assert.doesNotMatch(queries[1],/\$24|museum-galleries-tickets|PRIVATE/);
});
