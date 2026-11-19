import test from "node:test";
import assert from "node:assert/strict";
import { BOOKING_BRIEF_STATEMENT, buildLodgingBrief, fixtureLodgingAdapter, lodgingAdapterFor, lodgingDatesComplete, sameApprovedSnapshot, searchInputFromBrief, stayMatchesPrepared, type ApprovedStaySnapshot } from "./lodging";

const snapshot: ApprovedStaySnapshot = { stay: { id: "11111111-1111-4111-8111-111111111111", name: "Synthetic Dune Lodge", address: "4 Fixture Dunes Road", startsOn: "2027-02-12", endsOn: "2027-02-15", totalCents: 123_000 },
  travelerIds: ["22222222-2222-4222-8222-222222222222"] };
const approval = { proposalTurnId: "33333333-3333-4333-8333-333333333333", version: 1, approvedByPersonId: "22222222-2222-4222-8222-222222222222", approvedByName: "Robin Synthetic", approvedAt: "2026-10-06T12:00:00.000Z" };

test("the fixture provider is labeled synthetic everywhere and filters by shared constraints only", async () => {
  assert.equal(lodgingAdapterFor(undefined), fixtureLodgingAdapter);
  assert.throws(() => lodgingAdapterFor("live-supplier"), /not available/, "an unknown provider is refused, not substituted");
  const input = searchInputFromBrief({ focus: "Lodging", startsOn: "2027-02-12", endsOn: "2027-02-15", locationName: "Breckenridge", returnAudience: "shared",
    constraints: [{ kind: "max_nightly_cents", text: "Under $300", value: 30_000 }, { kind: "min_bedrooms", text: "Three bedrooms", value: 3 }] });
  assert.deepEqual(input, { locationName: "Breckenridge", maxNightlyCents: 30_000, minBedrooms: 3, nights: 3 });
  const found = await fixtureLodgingAdapter.search(input);
  assert.deepEqual(found.options.map(option => option.name), ["Synthetic Pine Cabin", "Synthetic Cove Cottage"]);
  assert.ok(found.evidence.every(item => item.synthetic && item.url.startsWith("https://fixture.invalid/")));
  assert.ok(found.options.every(option => option.caveats.some(caveat => /Synthetic fixture/.test(caveat))));
});

test("saved dates must be complete and ordered before lodging is researched or proposed", () => {
  assert.equal(lodgingDatesComplete({ startsOn: "2027-02-12", endsOn: "2027-02-15" }), true);
  assert.equal(lodgingDatesComplete({ startsOn: null, endsOn: null }), false);
  assert.equal(lodgingDatesComplete({ startsOn: "2027-02-12", endsOn: null }), false);
  assert.equal(lodgingDatesComplete({ startsOn: null, endsOn: "2027-02-15" }), false);
  assert.equal(lodgingDatesComplete({ startsOn: "2027-02-15", endsOn: "2027-02-12" }), false);
});

test("approval never transfers: any change to the approved stay or its travelers is a different snapshot; review may change travelers but not the option", () => {
  assert.equal(sameApprovedSnapshot(snapshot, structuredClone(snapshot)), true);
  assert.equal(sameApprovedSnapshot(snapshot, { ...snapshot, stay: { ...snapshot.stay, currency: "USD" } }), true, "legacy snapshots were USD");
  assert.equal(sameApprovedSnapshot(snapshot, { ...snapshot, stay: { ...snapshot.stay, currency: "EUR" } }), false, "currency changes invalidate legacy approval too");
  assert.equal(sameApprovedSnapshot(snapshot, null), false, "a deleted stay");
  assert.equal(sameApprovedSnapshot(snapshot, { ...snapshot, stay: { ...snapshot.stay, totalCents: 1 } }), false);
  assert.equal(sameApprovedSnapshot(snapshot, { ...snapshot, travelerIds: [] }), false);
  const prepared = { name: snapshot.stay.name, address: snapshot.stay.address, startsOn: snapshot.stay.startsOn, endsOn: snapshot.stay.endsOn, totalCents: 123_000 };
  assert.equal(stayMatchesPrepared({ ...prepared }, prepared), true);
  assert.equal(stayMatchesPrepared({ ...prepared, name: "A different cabin" }, prepared), false);
  assert.equal(stayMatchesPrepared(null, prepared), false);
});

test("the brief is preparation only, keeps synthetic provenance, and lists what is still unknown", () => {
  const brief = buildLodgingBrief({ tripName: "Synthetic Breckenridge weekend", locationName: "Breckenridge", snapshot, fallbackTotalCents: 999, travelers: [{ personId: snapshot.travelerIds[0], name: "Robin Synthetic" }],
    research: { synthetic: true, evidenceUrls: ["https://fixture.invalid/lodging/dune-lodge"] }, constraintsApplied: ["Under $450 a night"], constraintsAddedLater: ["Pets welcome"], attendanceUnconfirmed: ["Taylor Synthetic"], approval });
  assert.equal(brief.preparationOnly, true);
  assert.equal(brief.statement, BOOKING_BRIEF_STATEMENT);
  assert.match(brief.statement, /Nothing has been booked, held, paid for, or sent to a supplier/);
  assert.equal(brief.selectedOption.synthetic, true);
  assert.equal(brief.selectedOption.totalCents, 123_000, "the approved stay's own total, not the fallback");
  assert.ok(brief.missingInformation.some(line => /synthetic fixture evidence/.test(line)));
  assert.ok(brief.missingInformation.some(line => /Taylor Synthetic has not said/.test(line)));
  assert.ok(brief.missingInformation.some(line => /Pets welcome/.test(line)));
  const unknownSource = buildLodgingBrief({ tripName: "t", locationName: null, snapshot, fallbackTotalCents: 1, travelers: [], research: null, constraintsApplied: [], constraintsAddedLater: [], attendanceUnconfirmed: [], approval });
  assert.equal(unknownSource.selectedOption.synthetic, true, "a missing shortlist is never presented as verified evidence");
});
