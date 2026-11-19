import assert from "node:assert/strict";
import test from "node:test";
import { claimsUnperformedAction, guardModelReply, refersToProposal, replyStreamGuard, reportsSavedBooking, withoutUnperformedClaims } from "./coordinator-claims";
test("active and passive task claims need an actual task receipt, not a different kind of proposal", () => {
  for (const claim of ["I created a task to confirm the van.", "A task has been created to confirm the van.", "The task was created and assigned to you.", "Your task is saved.", "I assigned the task to you.", "I completed the task.", "Your tasks were created."]) {
    assert.equal(guardModelReply(claim, { created: { tripChange: true } }).changed, true, claim);
  }
});

// R9: the coordinator books, pays, sends and saves nothing on its own, and a proposal is only a proposal until a human applies it. Model prose that
// claims or promises any of that is removed by code, and one plain note says nothing of the kind happened.
test("R9 sentences that claim or promise a booking, payment, message, calendar write or saved change are removed from every answer", () => {
  const claims = ["I've booked a table at Alpine Table for 5 p.m.", "I booked the lodge for you.", "Commons has sent the invite to everyone.", "The invitation has been sent.", "Your reservation is now confirmed.", "I've added it to your calendar.",
    "I paid the deposit.", "I'll book that for you.", "I can reserve it now.", "Let me send the group an email.", "I've saved the new total.", "I've updated the stay to $2,100.", "The budget is now $5,000.", "The draft has been applied.",
    "We've scheduled dinner for 5.", "I emailed Robin the plan.", "Done, it's been booked.",
    "I've marked it confirmed.", "I marked fly fishing as cancelled.", "I've moved fly fishing to 10 AM.", "Commons has rescheduled the lesson.", "I cancelled the sleigh ride.", "I will mark it as confirmed now.", "I will move it to Sunday.", "The plan has been marked confirmed."];
  for (const claim of claims) {
    assert.equal(claimsUnperformedAction(claim), true, claim);
    const guarded = withoutUnperformedClaims(`Alpine Table is close to the lodge. ${claim} Ridge Grill opens at 4.`);
    assert.equal(guarded.changed, true, claim);
    assert.doesNotMatch(guarded.text.replace(/Nothing was booked, paid, sent, scheduled, or saved by this reply\./, ""), /booked|reserve|sent the|invite|paid|saved the|updated the|budget is now|been applied|scheduled|emailed|calendar|been sent|confirmed/i, `${claim} -> ${guarded.text}`);
    assert.match(guarded.text, /Alpine Table is close to the lodge\./);
    assert.match(guarded.text, /Ridge Grill opens at 4\./);
    assert.match(guarded.text, /Nothing was booked, paid, sent, scheduled, or saved by this reply\./);
  }
  const only = withoutUnperformedClaims("I've booked it.");
  assert.match(only.text, /^Nothing was booked, paid, sent, scheduled, or saved by this reply\. Tell me what you’d like to do next/);
});

test("R9 ordinary answers, saved-record facts and honest limits are left exactly as written", () => {
  const fine = ["Alpine Table serves an early family menu, and availability is unverified.", "You could book a table yourself once you've picked a time.", "The saved stay is Synthetic Peak Lodge, and an organizer reported it as booked.",
    "I can't book or reserve anything, and nothing was booked.", "Nothing was sent, and I haven't saved a change.", "Would you like me to prepare a poll for the group to review?", "Robin's flight lands at 4:10 p.m., per the saved plan.",
    "Here's a suggested edit for you to review. Nothing is applied until you choose Apply."];
  for (const text of fine) {
    assert.equal(claimsUnperformedAction(text), false, text);
    assert.deepEqual(withoutUnperformedClaims(text), { text, changed: false }, text);
  }
});

test("A a claim of a drafted, prepared or started artifact is cut on a turn that produced none, and the coordinator offers instead", () => {
  const claims = ["I drafted a question for your review.", "I've prepared a poll for the group.", "I created a survey about dinner.", "I've set up a vote on the lodge.", "I put together a draft message for everyone.",
    "Here's a draft for you to look at.", "I started research on family restaurants.", "I've prepared a lodging update for review.", "Commons has drafted a proposal below.",
    "Commons has prepared an itinerary beside this conversation.", "I've built a rough plan for your review.", "Here's a proposed itinerary.", "I proposed itinerary changes beside this conversation."];
  for (const claim of claims) {
    const guarded = guardModelReply(`Alpine Table suits a family. ${claim} Nothing is shared until you publish it. Ridge Grill opens at 4.`, { created: {}, offer: "poll" });
    assert.equal(guarded.changed, true, claim);
    assert.match(guarded.text, /Alpine Table suits a family\./);
    assert.match(guarded.text, /Ridge Grill opens at 4\./);
    assert.doesNotMatch(guarded.text.replace("I haven’t drafted, prepared or started anything with this reply.", ""), /drafted|prepared a|created a|set up|put together|Here's a draft|started research|nothing is shared|proposal/i, `${claim} -> ${guarded.text}`);
    assert.match(guarded.text, /I haven’t drafted, prepared or started anything with this reply\./);
    assert.match(guarded.text, /Want me to prepare a poll for the group to review\?/);
  }
  // Without an offer intent there is no offer; the note alone says so.
  assert.doesNotMatch(guardModelReply("I drafted a poll.", { created: {} }).text, /Want me to/);
  // A model that already offers is not made to offer twice.
  assert.equal((guardModelReply("I drafted a poll. Want me to prepare a poll for the group?", { created: {}, offer: "poll" }).text.match(/Want me to prepare a poll/g) ?? []).length, 1);
});

test("A the same sentences stand when the turn really produced that artifact, and honest wording is untouched", () => {
  assert.equal(guardModelReply("I drafted a question for your review.", { created: { draft: true } }).changed, false);
  assert.equal(guardModelReply("I started research on family restaurants.", { created: { research: true } }).changed, false);
  assert.equal(guardModelReply("I've prepared a lodging update for review.", { created: { tripChange: true } }).changed, false);
  // Producing one kind does not excuse claiming another.
  assert.equal(guardModelReply("I started research on restaurants.", { created: { draft: true } }).changed, true);
  for (const fine of ["Want me to prepare a poll for the group to review?", "I can draft a question if you'd like.", "A poll could help settle dinner.", "Alpine Table has an early menu, and availability is unverified."]) {
    assert.deepEqual(guardModelReply(fine, { created: {}, offer: "poll" }), { text: fine, changed: false }, fine);
  }
  // Action claims are still cut whatever was produced.
  assert.equal(guardModelReply("I've booked a table.", { created: { draft: true, research: true, tripChange: true } }).changed, true);
});

// Production transcript, "Fly-fishing confirmation": the model described a review card that did not exist, twice.
const PHANTOM_REPLY_2 = "I can prepare that status change for review—my earlier statement was incorrect. Review and apply the suggested update to mark the Fly-fishing lesson confirmed based on your report; October 12 at 9 AM stays unchanged. Nothing is saved until you apply it.";
const PHANTOM_REPLY_3 = "The current snapshot shows no pending review card—my earlier reply described an update, but there isn't one saved for review. I'm including the suggestion again here: review and apply it to mark the Fly-fishing lesson confirmed. October 12 at 9 AM stays unchanged.";
const OFF = "Plan updates from chat are turned off right now. You can mark it confirmed in Plan.";
const STILL_TALKING = /suggested update|review and apply|including the suggestion|prepare that status change|Nothing is saved until you apply/i;

test("Fly-fishing transcript: each phrase that presents or promises a review card is cut on a turn with none", () => {
  const phrases = ["Review and apply the suggested update.", "I'm including the suggestion again here.", "Review and apply it to mark the Fly-fishing lesson confirmed.", "I can prepare that status change for review.",
    "Review and apply the suggested update to mark the Fly-fishing lesson confirmed based on your report.", "I've prepared a suggested update for you.", "Here's the suggested update for you to look at.", "The review card is below.",
    "Approve the proposal and the plan will change.", "I'm attaching the suggestion again."];
  for (const phrase of phrases) for (const enabled of [true, false]) {
    if (!phrase.startsWith("I've prepared")) assert.equal(refersToProposal(phrase, { enabled }), true, phrase); // "I've prepared" is the artifact-claim family, cut by the same guard
    const guarded = guardModelReply(`Fly fishing is saved as planned for 9 AM on Oct 12. ${phrase} The guide is James.`, { created: {}, tripChanges: { enabled, planStatus: "confirmed" } });
    assert.equal(guarded.changed, true, phrase);
    assert.match(guarded.text, /Fly fishing is saved as planned for 9 AM on Oct 12\./);
    assert.match(guarded.text, /The guide is James\./);
    assert.doesNotMatch(guarded.text, STILL_TALKING, `${phrase} -> ${guarded.text}`);
    assert.match(guarded.text, enabled ? /I couldn’t prepare a plan update from that, so there is no review card and nothing was saved\./ : /Plan updates from chat are turned off right now\. You can mark it confirmed in Plan\./, guarded.text);
  }
});

test("Fly-fishing transcript: the two real replies become honest text, with trip changes off and with them on", () => {
  const off2 = guardModelReply(PHANTOM_REPLY_2, { created: {}, tripChanges: { enabled: false, planStatus: "confirmed" } });
  assert.equal(off2.changed, true);
  assert.doesNotMatch(off2.text, STILL_TALKING);
  assert.match(off2.text, new RegExp(OFF.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(off2.text, /Nothing is saved until you apply it/, "the sentence about applying goes with the card it belonged to");
  const off3 = guardModelReply(PHANTOM_REPLY_3, { created: {}, tripChanges: { enabled: false, planStatus: null } });
  assert.doesNotMatch(off3.text, /including the suggestion|review and apply/i);
  assert.match(off3.text, /Plan updates from chat are turned off right now\. You can mark it confirmed in Plan\./, "the status is read from what the model was talking about when the request gave none");
  assert.doesNotMatch(off3.text, /Nothing was booked/, "no unrelated booking note");
  const on2 = guardModelReply(PHANTOM_REPLY_2, { created: {}, tripChanges: { enabled: true } });
  assert.doesNotMatch(on2.text, STILL_TALKING);
  assert.match(on2.text, /I couldn’t prepare a plan update from that, so there is no review card and nothing was saved\. Tell me which plan and which status/);
  // A cancellation is worded as one.
  assert.match(guardModelReply("Review and apply the suggested update to mark it cancelled.", { created: {}, tripChanges: { enabled: false } }).text, /You can mark it cancelled in Plan\./);
  // Not about a plan: the generic wording, not the plan wording.
  const budget = guardModelReply("Review and apply the suggested update to set the budget to $5,000.", { created: {}, tripChanges: { enabled: false } });
  assert.match(budget.text, /Trip updates from chat are turned off right now\. You can make the change directly on the trip\./);
  assert.doesNotMatch(budget.text, /Plan updates/);
});

test("Fly-fishing transcript: offers are honest only where the capability exists, and a real review or pending card is left alone", () => {
  const offer = "I can prepare a plan update if you tell me which status you want.";
  assert.deepEqual(guardModelReply(offer, { created: {}, tripChanges: { enabled: true } }), { text: offer, changed: false }, "an open offer where trip changes are on");
  const off = guardModelReply(`Fly fishing is saved as planned. ${offer}`, { created: {}, tripChanges: { enabled: false } });
  assert.equal(off.changed, true, "the same offer where they are off");
  assert.doesNotMatch(off.text, /I can prepare/);
  assert.equal(guardModelReply("Want me to prepare a plan update for review?", { created: {}, tripChanges: { enabled: false } }).changed, true);
  // The turn really produced the review: its words stand.
  assert.equal(guardModelReply("Review and apply the suggested update.", { created: { tripChange: true }, tripChanges: { enabled: true } }).changed, false);
  // A review that already exists in this conversation may be referred to, but a promise of a new one is still cut.
  assert.equal(guardModelReply("Review and apply the suggested update above.", { created: {}, tripChanges: { enabled: true, pending: true } }).changed, false);
  assert.equal(guardModelReply("I can prepare that status change for review.", { created: {}, tripChanges: { enabled: true, pending: true } }).changed, true);
  // Without the option nothing about proposals is touched, and ordinary wording is never cut.
  assert.equal(guardModelReply("Review and apply the suggested update.", { created: {} }).changed, false);
  for (const fine of ["Fly fishing is saved as planned for 9 AM on Oct 12.", "You can review it with the group before deciding.", "The guide can confirm the time when you call.", "An organizer can mark it confirmed in Plan.", "Robin should apply for the permit by Friday."]) {
    assert.deepEqual(guardModelReply(fine, { created: {}, tripChanges: { enabled: false } }), { text: fine, changed: false }, fine);
    assert.equal(refersToProposal(fine, { enabled: false }), false, fine);
  }
  // Booking claims are still cut and still get their own note beside the new one.
  const both = guardModelReply("I've booked it. Review and apply the suggested update.", { created: {}, tripChanges: { enabled: false, planStatus: null } });
  assert.match(both.text, /Nothing was booked, paid, sent, scheduled, or saved by this reply\./);
  assert.match(both.text, /Plan updates from chat are turned off/);
});

// Held-out benchmark finding (docs/COORDINATOR-PERFORMANCE-REVIEW.md §2a): "Which lodge did we end up booking?" lost the lodge's name because a
// report of the saved booking read as a claim. A report of a record the trip already has saved as booked is kept; anything Commons could be claiming
// to have done is still cut.
test("reports of a booking the trip already has saved are kept; look-alike claims are still cut", () => {
  const saved = ["Synthetic Peak Lodge", "Fly-fishing lesson"];
  const reports = [
    "We booked Synthetic Peak Lodge for February 12–15.",
    "You've booked Synthetic Peak Lodge, as an organizer reported.",
    "Your stay at Synthetic Peak Lodge has been booked and is confirmed.",
    "Synthetic Peak Lodge was booked by Casey.",
    "Casey booked the stay at Synthetic Peak Lodge.",
    "The fly-fishing lesson was confirmed for Saturday morning.",
  ];
  for (const text of reports) {
    const guarded = guardModelReply(`That's your saved stay. ${text} Check-in is after 4.`, { created: {}, savedBookings: saved });
    assert.equal(guarded.changed, false, `${text} -> ${guarded.text}`);
    assert.deepEqual(withoutUnperformedClaims(text, saved), { text, changed: false }, text);
    assert.equal(reportsSavedBooking(text, saved), true, text);
  }
  const claims = [
    "I booked Synthetic Peak Lodge for you.",
    "I've booked Synthetic Peak Lodge.",
    "Commons reserved Synthetic Peak Lodge.",
    "Synthetic Peak Lodge is now booked.",
    "I've just confirmed Synthetic Peak Lodge.",
    "We booked Alpine Table near Synthetic Peak Lodge.",
    "We've booked a table for six at Alpine Table.",
    "We emailed Synthetic Peak Lodge and booked it.",
    "Synthetic Peak Lodge has been paid.",
    "The deposit for Synthetic Peak Lodge has been paid and booked.",
    "Done, it's been booked.",
    "Your reservation is now confirmed.",
    "The ski lessons have been booked.",
  ];
  for (const text of claims) {
    const guarded = guardModelReply(`That's your saved stay. ${text} Check-in is after 4.`, { created: {}, savedBookings: saved });
    assert.equal(guarded.changed, true, text);
    assert.match(guarded.text, /Nothing was booked, paid, sent, scheduled, or saved by this reply\./, text);
    assert.equal(withoutUnperformedClaims(text, saved).changed, true, text);
  }
  // With nothing saved as booked, the old rule applies unchanged.
  assert.equal(guardModelReply("We booked Synthetic Peak Lodge for February 12–15.", { created: {} }).changed, true);
});

test("the stream guard keeps a saved-booking report in the prefix, so streamed text still matches the saved reply", () => {
  const options = { created: {}, savedBookings: ["Synthetic Peak Lodge"] };
  const reply = "We booked Synthetic Peak Lodge for February 12–15. Check-in is after 4. Enjoy the trip.";
  const guard = replyStreamGuard(options);
  let shown: string | null = null;
  for (let end = 1; end <= reply.length; end += 1) shown = guard.next(reply.slice(0, end)) ?? shown;
  assert.equal(shown, "We booked Synthetic Peak Lodge for February 12–15. Check-in is after 4.");
  assert.ok(guardModelReply(reply, options).text.startsWith(shown!));
});


test("A promise to prepare a plan review requires an actual artifact, including the live regression wording", () => {
  const text = "I will prepare the plan update to move the fly-fishing lesson from Monday, Oct 12 at 9:00 AM to Sunday, Oct 11 at 9:00 AM for your review.";
  assert.equal(guardModelReply(text, { created: {}, tripChanges: { enabled: true } }).changed, true);
  assert.equal(guardModelReply(text, { created: { tripChange: true }, tripChanges: { enabled: true } }).changed, false);
  const stream = replyStreamGuard({ created: {}, tripChanges: { enabled: true } });
  assert.equal(stream.next(`${text} Next sentence.`), null);
  assert.equal(stream.frozen, true);
});

test("Santa Barbara phantom activity claims are removed before saving or streaming", () => {
 for (const claim of ["Saved nine activity ideas in Plan.", "Your nine activity ideas were added to Plan.", "The nine activities are saved in Plan.", "I have created nine planned ideas based on your list.","The nine planned ideas have now been added to your trip plan.","I've prepared the nine activity ideas as planned, unconfirmed plans."]) {
  const options={created:{},tripChanges:{enabled:true}};
  const guarded=guardModelReply(claim,options);assert.equal(guarded.changed,true,claim);assert.ok(!guarded.text.includes(claim));
  const stream=replyStreamGuard(options);let shown="";
  for(let i=1;i<=claim.length;i++) shown=stream.next(claim.slice(0,i))??shown;
  assert.ok(!shown.includes(claim),shown);assert.ok(guarded.text.startsWith(shown),shown);
 }
 assert.equal(guardModelReply("I created a poll for review.",{created:{draft:true}}).changed,false);
});

test("wording-edit completion claims require the saved receipt too",()=>{
 for(const text of ["I shortened the introduction.","I've rewritten the message.","We reworded the title."])assert.equal(claimsUnperformedAction(text),true,text);
});


test("absence of a saved dinner plan is not a Commons save receipt", () => {
  for (const text of ["No dinner plan or decision is saved for the Feb 12–15 trip, so dinner details remain unresolved.", "No dinner plan is saved yet, and the restaurant choice is still tentative."]) {
    assert.equal(claimsUnperformedAction(text), false);
    assert.equal(guardModelReply(text, { created: {} }).text, text);
  }
  for (const text of ["No dinner plan is saved, but I booked the restaurant.", "No plan is saved. I've paid the deposit.", "Your dinner plan is saved.", "No plan is saved, but your activities are saved."]) assert.equal(claimsUnperformedAction(text), true);
});
