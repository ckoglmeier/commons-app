import assert from "node:assert/strict";
import test from "node:test";
import type { Stay } from "@commons/contracts";
import { stayComparison, stayPollDescription } from "./stay-compare";

const stay = (id: string, extra: Partial<Stay> = {}): Stay => ({ id, name: id, address: `${id} address`, startsOn: "2026-11-05", endsOn: "2026-11-07",
  status: "considering", includedPersonIds: ["a", "b", "c", "d", "e", "f", "g"], sourceLabel: "Added", ...extra });

test("compares price per person per night and distance to placed activities", () => {
  const lodge = stay("Lodge", { totalCents: 136_200 * 4, currency: "USD", costSource: "estimate", includesTaxesAndFees: true,
    pin: { latitude: 38.2797, longitude: -122.4585, precision: "exact", source: "page" } });
  const compared = stayComparison([lodge, stay("Inn")], [{ id: "plaza", title: "Plaza", startsAt: null, participantScope: "everyone", status: "idea", provenanceLabel: "x",
    pin: { latitude: 38.2933, longitude: -122.458, precision: "exact", source: "map_link" } }], "America/Los_Angeles");
  const row = compared.get("Lodge")!;
  assert.equal(row.nights, 2);
  assert.equal(row.price?.total, "$5,448 total estimate with taxes and fees");
  assert.equal(row.price?.perPersonPerNight, "about $389.14 per person per night");
  assert.equal(row.distance, "0.9 mi from 1 activity");
  assert.equal(compared.get("Inn")!.price, null);
  assert.equal(compared.get("Inn")!.distance, "Not on the map");
  assert.equal(stayPollDescription({ ...lodge, details: "Two queens per room" }, row), "Lodge address · $5,448 total estimate with taxes and fees, about $389.14 per person per night · Two queens per room");
});

test("per-room quotes compare per room per night until a room count makes a group total", () => {
  const lodge = stay("Lodge", { roomPriceCents: 136_200, currency: "USD", includesTaxesAndFees: true });
  const quoted = stayComparison([lodge], [], "UTC").get("Lodge")!;
  assert.equal(quoted.price?.total, "$1,362 per room for 2 nights with taxes and fees");
  assert.equal(quoted.price?.perRoomPerNight, "about $681 per room per night");
  assert.equal(quoted.price?.perPersonPerNight, "Rooms needed not set");
  assert.equal(stayPollDescription(lodge, quoted), "Lodge address · $1,362 per room for 2 nights with taxes and fees, about $681 per room per night");
  const counted = stayComparison([{ ...lodge, roomCount: 4 }], [], "UTC").get("Lodge")!;
  assert.equal(counted.price?.perPersonPerNight, "4 rooms: $5,448 total, about $389.14 per person per night");
});

test("long poll descriptions end on a whole word", () => {
  const long = stay("Lodge", { details: "Two double beds. Parking, meals and incidentals extra; check cancellation terms before booking anything for the group this year please, and confirm whether the pool and spa are open in early November." });
  const text = stayPollDescription(long, stayComparison([long], [], "UTC").get("Lodge")!)!;
  assert.ok(text.length <= 180);
  assert.match(text, /\w…$/);
});
