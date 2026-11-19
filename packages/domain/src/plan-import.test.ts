import assert from "node:assert/strict";
import test from "node:test";
import { parsePlanImportText } from "./plan-import";

test("turns dated notes into reviewable itinerary items with source lines", () => {
  const result = parsePlanImportText({
    text: `Cape Cod\nThursday, July 22\n- Beach at 1:30 PM · Old Silver Beach\n- Dinner at 7:30 PM · C Salt Wine Bar\nFriday, July 23\n- Open morning\n- Sunset sail at 4 PM`,
    startsOn: "2027-07-18",
    endsOn: "2027-07-25",
    sourceKind: "pasted_notes",
    sourceLabel: "Pasted notes",
  });

  assert.equal(result.items.length, 4);
  assert.equal(result.items[0].date, "2027-07-22");
  assert.equal(result.items[0].time, "13:30");
  assert.equal(result.items[0].title, "Beach");
  assert.equal(result.items[0].location, "Old Silver Beach");
  assert.match(result.items[0].sourceLabel, /line 3/);
  assert.equal(result.items[2].needsReview, true);
});

test("ignores plans outside the trip dates", () => {
  const result = parsePlanImportText({
    text: "July 10, 2027 - Dinner at 7 PM\nJuly 19, 2027 - Dinner at 7 PM",
    startsOn: "2027-07-18",
    endsOn: "2027-07-25",
    sourceKind: "email_export",
    sourceLabel: "Email export",
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].date, "2027-07-19");
});

test("reads a simple Google Sheet export", () => {
  const result = parsePlanImportText({
    text: "Date,Plan,Time,Place\n7/22/2027,Dinner,7:30 PM,C Salt Wine Bar",
    startsOn: "2027-07-18",
    endsOn: "2027-07-25",
    sourceKind: "spreadsheet",
    sourceLabel: "Google Sheet",
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, "Dinner");
  assert.equal(result.items[0].location, "C Salt Wine Bar");
});

test("turns a rough multi-stop route into a reviewable dated draft", () => {
  const result = parsePlanImportText({
    text: `Scotland trip — summer 2027

Maybe:
- 3 nights Edinburgh
- 2 nights Cairngorms or Aviemore
- 2 nights near Inverness
- 3 nights Isle of Skye
- 2 nights Glencoe
- 1 night Glasgow

Important: nothing is booked yet. This is brainstorming, not an approved itinerary.`,
    startsOn: "2027-06-20",
    endsOn: "2027-07-04",
    sourceKind: "pasted_notes",
    sourceLabel: "Pasted notes",
  });

  assert.equal(result.items.length, 6);
  assert.equal(result.items[0].title, "Edinburgh · 3 nights");
  assert.equal(result.items[0].date, "2027-06-20");
  assert.equal(result.items[1].date, "2027-06-23");
  assert.equal(result.items[2].location, "Inverness");
  assert.equal(result.items[5].date, "2027-07-02");
  assert.equal(result.items.every((item) => item.needsReview), true);
  assert.match(result.warnings[0], /Check each date/);
});
