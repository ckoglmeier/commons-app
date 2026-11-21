import assert from "node:assert/strict";
import test from "node:test";
import { messageParts, messagingCopy, webMessagingCopy } from "./messaging-copy";

test("help names the contact email when there is one, and points to the organizer when there isn't", () => {
  assert.match(messagingCopy.help("help@example.com"), / Help: help@example\.com$/);
  assert.match(webMessagingCopy.help("help@example.com"), / Help: help@example\.com$/);
  for (const body of [messagingCopy.help("the trip organizer"), webMessagingCopy.help("the trip organizer")]) {
    assert.match(body, / For help, ask your trip organizer\.$/, body);
    assert.doesNotMatch(body, /Help:/, body);
  }
});

test("a code that doesn't save says it doesn't match, not that it is older", () => {
  assert.equal(messagingCopy.reviewStaleCode("Sonoma", "ABC"), "Sonoma: that code doesn't match the latest summary. The current code is ABC. Reply SAVE ABC if the latest summary is right.");
  assert.equal(webMessagingCopy.reviewStaleCode("Sonoma", "ABC"), "Sonoma: that code doesn't match the latest summary. The current code is ABC. Reply SAVE ABC if the latest summary is right.");
});

test("the welcome says the dates once", () => {
  const trip = { firstName: "Maya", tripName: "Lake Tahoe ski weekend", startsOn: "2027-02-12", endsOn: "2027-02-15" };
  assert.equal(webMessagingCopy.welcome({ ...trip, question: "are you in for Feb 12 to Feb 15? Reply YES, NO or MAYBE." }),
    "Hi Maya, this is Commons, an automated assistant for Lake Tahoe ski weekend. Are you in for Feb 12 to Feb 15? Reply YES, NO or MAYBE.");
  assert.equal(webMessagingCopy.welcome({ ...trip, question: webMessagingCopy.welcomeAsk }),
    "Hi Maya, this is Commons, an automated assistant for Lake Tahoe ski weekend (Feb 12 to Feb 15). Ask me about the saved plan, or send me a booking and I'll add it for your review.", "a question without the dates keeps them");
  assert.match(messagingCopy.welcome({ ...trip, question: "are you in for Feb 12 to Feb 15? Reply YES, NO or MAYBE." }), /^Commons: Hi Maya, this is Commons, an automated assistant for Lake Tahoe ski weekend\. Save this number as Commons\. Are you in for Feb 12 to Feb 15\?/);
});

test("links in Commons's messages go only to this site", () => {
  const origin = "https://commons.example.com";
  assert.deepEqual(messageParts("You can edit it in Money: https://commons.example.com/c/abc?view=money", origin),
    [{ text: "You can edit it in Money: " }, { text: "https://commons.example.com/c/abc?view=money", href: "https://commons.example.com/c/abc?view=money" }]);
  assert.deepEqual(messageParts("See https://other.example.com/x or https://commons.example.com.other.example.com/y", origin), [{ text: "See https://other.example.com/x or https://commons.example.com.other.example.com/y" }], "another origin stays text");
  assert.deepEqual(messageParts("Not https://commons.example.com@other.example.com/x", origin), [{ text: "Not https://commons.example.com@other.example.com/x" }]);
  assert.deepEqual(messageParts("Open it (https://commons.example.com/c/abc).", origin),
    [{ text: "Open it (" }, { text: "https://commons.example.com/c/abc", href: "https://commons.example.com/c/abc" }, { text: ")." }], "trailing punctuation stays outside the link");
  for (const mark of [".", ",", "!", "?"]) assert.equal(messageParts(`Here: https://commons.example.com/p${mark}`, origin)[1]?.href, "https://commons.example.com/p");
  assert.deepEqual(messageParts("https://commons.example.com/a, then https://commons.example.com/b", `${origin}/`).map(part => part.href ?? null), ["https://commons.example.com/a", null, "https://commons.example.com/b"], "several links");
  assert.deepEqual(messageParts("No link here.", origin), [{ text: "No link here." }]);
  assert.deepEqual(messageParts("ftp://commons.example.com/x", origin), [{ text: "ftp://commons.example.com/x" }]);
  assert.deepEqual(messageParts("Edit: https://commons.example.com/x", null), [{ text: "Edit: https://commons.example.com/x" }], "no origin, no links");
});

test("someone not on the booked stay is told so, with the count in words that fit", () => {
  for (const copy of [messagingCopy, webMessagingCopy]) {
    assert.equal(copy.planNotOnStay("Sonoma Weekend", "Vineyard Cottage", 3), "Sonoma Weekend: Vineyard Cottage is booked for 3 people, and you're not on it yet. Ask the organizer to add you.");
    assert.equal(copy.planNotOnStay("Sonoma Weekend", "Vineyard Cottage", 1), "Sonoma Weekend: Vineyard Cottage is booked for 1 person, and you're not on it yet. Ask the organizer to add you.");
  }
});
