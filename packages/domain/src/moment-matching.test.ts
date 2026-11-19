import assert from "node:assert/strict";
import test from "node:test";
import { suggestMomentEventMatch } from "./moment-matching";

const itinerary = [
  {
    id: "golf",
    title: "Morning golf",
    startsAt: "2026-06-06T12:05:00.000Z",
    endsAt: "2026-06-06T16:45:00.000Z",
    location: "Sea Island Golf Club",
  },
  {
    id: "departures",
    title: "Departures",
    startsAt: "2026-06-07T16:00:00.000Z",
    location: "Jacksonville + home",
  },
];

test("prefers event-specific context over generic trip location words", () => {
  const match = suggestMomentEventMatch(
    {
      occurredAt: "2026-06-05T00:45:00.000Z",
      caption: "Porch, night one",
      altText: "The warmly lit entrance to Porch restaurant beneath live oak trees",
    },
    [
      {
        id: "arrivals",
        title: "Arrivals + Inn check-in",
        startsAt: "2026-06-04T18:00:00.000Z",
        endsAt: "2026-06-05T00:45:00.000Z",
        location: "The Inn by Sea Island",
      },
      {
        id: "porch",
        title: "Dinner at Porch",
        startsAt: "2026-06-05T01:00:00.000Z",
        location: "Porch",
      },
    ],
  );

  assert.equal(match?.itineraryItemId, "porch");
});

test("matches a photo when timing and event context agree", () => {
  const match = suggestMomentEventMatch(
    {
      occurredAt: "2026-06-06T17:30:00.000Z",
      caption: "Saturday group",
      altText: "Three friends beside a pond on the golf course",
    },
    itinerary,
  );

  assert.equal(match?.itineraryItemId, "golf");
  assert.equal(match?.source, "automatic");
  assert.ok((match?.confidence ?? 0) >= 75);
});

test("does not force a nearby photo onto an unrelated event", () => {
  const match = suggestMomentEventMatch(
    {
      occurredAt: "2026-06-06T14:13:00.000Z",
      caption: "A quiet beach reset",
      altText: "The beach and Atlantic Ocean beneath soft blue clouds",
    },
    itinerary,
  );

  assert.equal(match, undefined);
});
