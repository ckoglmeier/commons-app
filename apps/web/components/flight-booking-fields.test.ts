import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FlightBookingFields, blankFlightConnection, summarizeFlightReview } from "./flight-booking-fields";

test("direct flights keep one editor, both directions offer Add connection and only multi-flight directions offer removal", () => {
  const first = { ...blankFlightConnection(), origin: "DEN", destination: "LHR", departureDate: "2027-03-20", arrivalDate: "2027-03-21", departureTime: "20:00", arrivalTime: "11:00" };
  const final = { ...first, origin: "LHR", destination: "NCE", departureDate: "2027-03-21", arrivalTime: "16:00" };
  const legs = [summarizeFlightReview({ kind: "arrival", route: "", date: "", time: "" }, [first]), summarizeFlightReview({ kind: "departure", route: "", date: "", time: "" }, [first, final])];
  const html = renderToStaticMarkup(createElement(FlightBookingFields, { legs, onChange() {}, addHome() {}, removeHome() {} }));
  assert.equal(html.match(/Add connection/g)?.length, 2);
  assert.equal(html.match(/class="flight-connection-remove"/g)?.length, 2);
  assert.match(html, /Trip arrival.*Sunday, March 21.*11:00 AM/);
  assert.match(html, /Trip departure.*Saturday, March 20.*8:00 PM/);
  assert.match(html, /Arrives Sunday, March 21/);
});

test("legacy routes stay editable and imported direction splitting remains available", () => {
  const props = { onChange() {}, addHome() {}, removeHome() {} };
  const legacy = renderToStaticMarkup(createElement(FlightBookingFields, { ...props, legs: [{ kind: "arrival", route: "DEN → SNA", date: "2027-03-20", time: "10:00" }] }));
  assert.match(legacy, /Add departure and arrival details/);
  assert.match(legacy, /value="DEN → SNA"/);
  const connected = renderToStaticMarkup(createElement(FlightBookingFields, { ...props, legs: [{ kind: "arrival", route: "", date: "", time: "", connections: [blankFlightConnection(), blankFlightConnection()] }] }));
  assert.match(connected, /This starts the flight home/);
});
