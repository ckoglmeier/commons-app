import test from "node:test";
import assert from "node:assert/strict";
import { parseOrganizerActivities } from "@commons/contracts";

export const santaBarbaraList = "Add as ideas: Seal Sanctuary, MOXI, Sea Center, Local LIbraries, DOuglas Family Preserve, Lotus Land Gardens, Ice Skating, Children's Museum, Family Friendly Show at Santa Barbara Bowl";
export const santaBarbaraTitles = ["Seal Sanctuary", "MOXI", "Sea Center", "Local LIbraries", "DOuglas Family Preserve", "Lotus Land Gardens", "Ice Skating", "Children's Museum", "Family Friendly Show at Santa Barbara Bowl"];

test("the supplied Santa Barbara list preserves all nine names without researching or correcting them", () => {
  assert.deepEqual(parseOrganizerActivities(santaBarbaraList), { titles: santaBarbaraTitles, error: null });
});

test("explicit title lists support bullets, quoted commas and bounded deduplication", () => {
  assert.deepEqual(parseOrganizerActivities('Please add activities:\n- MOXI\n- "Art, science and play"\n- Sea Center'), {titles:["MOXI", "Art, science and play", "Sea Center"],error:null});
  assert.deepEqual(parseOrganizerActivities("Can you save as planned ideas: MOXI, MOXI, Sea Center"), {titles:["MOXI", "Sea Center"],error:null});
  assert.equal(parseOrganizerActivities(`Add as ideas: ${Array.from({length:24},(_,i)=>`Activity ${i}`).join(", ")}`)?.titles.length,24);
});

test("ambiguous lists, other changes and partial lists cannot authorize any activity writes", () => {
  for (const text of ["Add as ideas:", "Add as ideas: MOXI,, Zoo", 'Add as ideas: MOXI, "Zoo', "Add as ideas: MOXI,", "Add as ideas: MOXI, Confirm the hotel", "Add as ideas: MOXI tomorrow", "Add as ideas: Zoo on Monday", "Add as ideas: Zoo on October 5", "Add as ideas: Zoo once we agree", "Add as ideas: MOXI, update the budget to $500", "Add as ideas: Zoo if we have time", "Add as ideas: Zoo at 1:12 PM", "Add as ideas: Zoo; don't add it yet", `Add as ideas: ${"x".repeat(201)}`, `Add as ideas: ${Array.from({length:25},(_,i)=>`Activity ${i}`).join(", ")}`]) {
    const parsed=parseOrganizerActivities(text); assert.ok(parsed?.error,text); assert.deepEqual(parsed?.titles,[],text);
  }
  for (const text of ["Should we add these as ideas: MOXI, Zoo?", "Don't add as ideas: MOXI", "Research activities: Zoo", "Here is a conversation: Add as ideas: Zoo", "Save these later as ideas: MOXI", "I have created nine planned ideas", "Yes, do that", "Add these as confirmed: Zoo"]) assert.equal(parseOrganizerActivities(text),null,text);
});
