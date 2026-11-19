import assert from "node:assert/strict";
import test from "node:test";
import { attendanceStatementTargets, formatTripDateRange, reportsOwnAttendance, latestOwnAttendanceReport } from "@commons/contracts";

test("explicit self and group attendance statements offer only the speaker's RSVP", () => {
  for (const text of ["I'm attending", "We’re both attending.", "We are all attending the trip", "Both of us are attending!", "Alex and I are both attending", "Save my attendance"]) assert.equal(reportsOwnAttendance(text), true, text);
  for (const text of ["Are we both attending?", "I'm not attending", "We might both attend", "If we're both attending", "I'm attending dinner", "Alex is attending", 'Alex said "I am attending"', "We were both attending", "Poll us about attendance", "I am attending. Actually, maybe not."]) assert.equal(reportsOwnAttendance(text), false, text);
});

test("later uncertainty and saved responses supersede an earlier statement", () => {
  const earlier = { id: "one", userText: "We're both attending", createdAt: new Date("2026-09-28T10:00:00Z") };
  const response = new Date("2026-09-28T09:00:00Z");
  assert.deepEqual(latestOwnAttendanceReport([earlier], response), { turnId: "one", source: earlier.userText });
  assert.equal(latestOwnAttendanceReport([{ ...earlier, id: "two", userText: "I might not attend", createdAt: new Date("2026-09-28T11:00:00Z") }, earlier], response), null);
  assert.equal(latestOwnAttendanceReport([earlier], new Date("2026-09-28T12:00:00Z")), null);
});


test("attendance statements resolve only explicit and unambiguous active travelers", () => {
  const roster = [{ personId: "a", displayName: "Alex" }, { personId: "b", displayName: "Sam Smith" }];
  assert.deepEqual(attendanceStatementTargets("We're both attending", "a", roster), ["a", "b"]);
  assert.deepEqual(attendanceStatementTargets("Sam and I are both attending.", "a", roster), ["a", "b"]);
  assert.deepEqual(attendanceStatementTargets("I'm attending", "a", roster), ["a"]);
  assert.equal(attendanceStatementTargets("We're attending", "a", roster), null);
  assert.equal(attendanceStatementTargets("We're both attending", "a", [...roster, { personId: "c", displayName: "Taylor" }]), null);
  assert.equal(attendanceStatementTargets("Sam and I are attending", "a", [...roster, { personId: "c", displayName: "Sam Jones" }]), null);
  assert.equal(attendanceStatementTargets("Sam and I are attending dinner", "a", roster), null);
});

test("F3 explicit whole-trip phrasings are attendance statements; a bare 'I'm coming' or 'I'll be there' (which could mean dinner) is not", () => {
  for (const text of ["I'm attending the whole trip", "I’ll be there for the whole trip", "Count me in for the whole trip", "I'm coming on the trip", "I am coming for the whole trip.", "Yes, I'm attending the whole trip", "I'm attending this whole trip!", "I will be there for the whole trip"]) {
    assert.equal(reportsOwnAttendance(text), true, text);
    assert.deepEqual(attendanceStatementTargets(text, "a", [{ personId: "a", displayName: "Alex" }, { personId: "b", displayName: "Sam" }]), ["a"], text);
  }
  for (const text of ["I'm coming", "I'll be there", "I'll be there at 5", "Count me in", "Count me in for dinner", "I'm coming to dinner", "I'm coming on the ski day", "I'll be there for the whole dinner", "Can I count me in for the whole trip?", "I might be there for the whole trip", "I'm not coming on the trip", "Robin will be there for the whole trip", "We're coming on the trip", "I'll be there for the trip if I can"]) {
    assert.equal(reportsOwnAttendance(text), false, text);
  }
  // The RSVP shortcut reads the same statements, and a later uncertain remark still supersedes them.
  const response = new Date("2026-09-28T09:00:00Z");
  for (const userText of ["Count me in for the whole trip", "I'll be there for the whole trip", "I'm coming on the trip"]) {
    assert.deepEqual(latestOwnAttendanceReport([{ id: "one", userText, createdAt: new Date("2026-09-28T10:00:00Z") }], response), { turnId: "one", source: userText }, userText);
  }
  const earlier = { id: "one", userText: "Count me in for the whole trip", createdAt: new Date("2026-09-28T10:00:00Z") };
  assert.equal(latestOwnAttendanceReport([{ id: "two", userText: "I might not be coming", createdAt: new Date("2026-09-28T11:00:00Z") }, earlier], response), null);
});

test("B trip dates read as human dates in the receipt: same month, cross-month, cross-year and single day", () => {
  assert.equal(formatTripDateRange("2027-02-12", "2027-02-15"), "Feb 12–15, 2027");
  assert.equal(formatTripDateRange("2027-02-28", "2027-03-02"), "Feb 28 – Mar 2, 2027");
  assert.equal(formatTripDateRange("2026-12-30", "2027-01-02"), "Dec 30, 2026 – Jan 2, 2027");
  assert.equal(formatTripDateRange("2027-02-12", "2027-02-12"), "Feb 12, 2027");
  assert.equal(formatTripDateRange("unset", "2027-02-12"), "unset – 2027-02-12", "anything that is not a plain date is left as given");
});
