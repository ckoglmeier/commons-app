import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Flights are shared and costs belong in Money; ground bookings retain sharing controls", async () => {
  const [source, css, bookingFields, travelWorkspace] = await Promise.all([
    readFile(new URL("./commons-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("./flight-booking-fields.tsx", import.meta.url), "utf8"),
    readFile(new URL("./travel-workspace.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(source, /Basic details shared with the trip/);
  assert.match(source, /Share basic info/);
  assert.match(source, /Share all info \(including cost\)/);
  assert.match(source, /confirmation numbers and original files stay private/);
  assert.match(source, /Planning amount only\. This does not add an expense or reimbursement\./);
  assert.match(source, /isGround/);
  assert.match(source, /Included travelers/);
  assert.match(source, /Travelers on this booking/);
  assert.match(source, /participants\.map\(\(participant\)/);
  const travelSheetStart = source.indexOf("function TravelPlansSheet(");
  const travelSheetEnd = source.indexOf("function TranscriptSheet(", travelSheetStart);
  assert.ok(travelSheetStart >= 0 && travelSheetEnd > travelSheetStart);
  assert.doesNotMatch(source.slice(travelSheetStart, travelSheetEnd), />Just me</);
  assert.match(source, /Return date/);
  assert.match(source, /Return time <small>Optional<\/small>/);
  assert.match(source, /const segmentsReady = isGround/);
  assert.doesNotMatch(source.slice(travelSheetStart, travelSheetEnd), /role="tablist"|travel-plan-list|Add another rental/);
  assert.match(source, /logistics-editor-header/);
  assert.match(bookingFields, /Add flight home/);
  assert.match(source, /method: "PUT"/);
  assert.doesNotMatch(source, /!returnDate \|\| !returnTime/);
  assert.match(source, /Remove travel plan/);
  assert.match(source, /Linked expenses remain recorded/);
  assert.match(source, /method: "DELETE"/);
  assert.match(travelWorkspace, /LogisticsAddMenu/);
  assert.match(source, /Confirmation attached/);
  assert.match(bookingFields, /Flights in this booking/);
  assert.match(source, /Flight costs belong in Money\./);
  assert.match(source, /totalCents: index === 0 \? input\.totalCents \?\? undefined : undefined/);
  assert.match(source, /Add confirmation/);
  assert.match(source, /uploadCommonsConfirmation/);
  assert.match(source, /The original confirmation will be attached as private receipt evidence\./);
  assert.match(source, /travelPlanId/);
  assert.match(source, /method: "PATCH"/);
  assert.doesNotMatch(source, /Keep this plan private/);
  assert.match(css, /\.travel-sharing-options > button \{[^}]*min-height: var\(--cm-touch-target\)/);
  assert.match(css, /\.confirmation-upload > button \{[^}]*min-height: var\(--cm-touch-target\)/);
  assert.match(css, /\.flight-segment-editor \{[^}]*min-width|\.flight-segments-review \{[^}]*min-width: 0/);
  assert.match(css, /\.flight-segment-editor \.travel-form-grid \{[^}]*margin-top: \.75rem/);
});
