import assert from "node:assert/strict";
import test from "node:test";
import { planNoteToSave, type TripPlanReview } from "@commons/contracts";
import { buildPlanChange, existingPlanReviewReply, isCompactPlanProposal, planProposalSpokenReply, planShortTimeLabel, findContactDetails, isPlanReport, normalizePlanId, planContactOption, planFollowUpGapReply, planFollowUpRequest, planGapReply, planProposalReply, planReport, planUpdatesOffReply, redactContactDetails, resolvePlan, resolvePlanFollowUp, type PlanContextItem, type PlanSuggestion } from "./coordinator-plan-proposal";
import { buildTripChangeProposal, parseTripSuggestion, tripProposalGap, tripRecordRequestSource, withPlanReferent, withReportedPlan, type TripProposalContext } from "./coordinator-trip-proposal";

const flyId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", sleighId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", floatId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const fly: PlanContextItem = { id: flyId, title: "Fly-fishing lesson", status: "planned", timezone: "America/Denver", startsAt: "2027-10-12T15:00:00.000Z", endsAt: "2027-10-12T18:00:00.000Z", note: null, updatedAt: "2027-09-01T12:00:00.000Z" };
const sleigh: PlanContextItem = { id: sleighId, title: "Sunset sleigh ride", status: "planned", timezone: "America/Denver", startsAt: "2027-10-13T00:00:00.000Z", endsAt: null, note: "Meet at the barn", updatedAt: "2027-09-01T12:00:00.000Z" };
const none: PlanSuggestion = { planId: null, planTitle: null, planStatus: null, planStartsOn: null, planStartsTime: null, planNote: null, planContactLabel: null };
const transcript = "We've confirmed fly fishing for 9 AM on 10/12. The guide (James)'s phone is 505-412-7380";

test("Reports of a confirmation, cancellation or time change are recognized; questions, hedges, wishes and negations are not", () => {
  const reports = [transcript, "Fly fishing is booked for 9 on 10/12", "we cancelled the sleigh ride", "fly fishing moved to 10 AM", "Mark fly fishing as confirmed", "The sleigh ride is cancelled.", "Cancel the sleigh ride",
    "I just confirmed the fly-fishing lesson for 9 a.m."];
  for (const text of reports) assert.notEqual(planReport(text), null, text);
  assert.equal(planReport("we cancelled the sleigh ride")?.status, "cancelled");
  assert.equal(planReport("fly fishing moved to 10 AM")?.reschedule, true);
  const notReports = ["Should we confirm fly fishing?", "Have we confirmed fly fishing", "Is fly fishing confirmed?", "We should confirm fly fishing tomorrow", "We'll confirm fly fishing once the guide replies", "maybe we'll cancel the sleigh ride",
    "We haven't confirmed fly fishing yet", "Do you think we should cancel the sleigh ride", "if the guide confirms fly fishing we can leave at 9", "Make a poll asking whether we confirmed fly fishing", "We need to confirm fly fishing", "What time is fly fishing?",
    "The guide is confirmed and unconfirmed guests are unknown?"];
  for (const text of notReports) assert.equal(planReport(text), null, text);
});

test("A report routes to a plan update only when it names a saved plan, or carries a date or time so the answer can say none matches", () => {
  const saved = [fly, sleigh];
  assert.equal(isPlanReport(transcript, saved), true);
  assert.equal(isPlanReport("we cancelled the sleigh ride", saved), true);
  assert.equal(isPlanReport("We confirmed paddleboarding for 9 AM on 10/12", saved), true, "no saved match, but a scheduled confirmation: answered by code");
  assert.equal(isPlanReport("We cancelled the paddleboarding", saved), false, "no match and nothing scheduled: an ordinary answer");
  assert.equal(isPlanReport("We confirmed this with Robin", saved), false);
  assert.equal(isPlanReport("Should we confirm fly fishing?", saved), false);
});

test("Fly fishing clearly matches the Fly-fishing lesson; two fishing items or none are not guessed; the model's id is only a corroborated hint", () => {
  assert.equal(resolvePlan("We've confirmed fly fishing", [fly, sleigh]).kind, "unique");
  const float: PlanContextItem = { ...fly, id: floatId, title: "Fly-fishing float trip" };
  const two = resolvePlan("We've confirmed fly fishing", [fly, float, sleigh]);
  assert.equal(two.kind, "ambiguous");
  assert.deepEqual(two.kind === "ambiguous" ? two.plans.map(plan => plan.id).sort() : [], [floatId, flyId].sort());
  assert.equal(resolvePlan("We've confirmed paddleboarding", [fly, sleigh]).kind, "none");
  assert.equal(resolvePlan("We've confirmed the sleigh ride", [{ ...sleigh, status: "cancelled" }]).kind, "none", "a cancelled plan is not a target");
  // The model can break a tie with an id the words support; an id the words do not support changes nothing.
  const hinted = resolvePlan("We've confirmed fly fishing", [fly, float], floatId);
  assert.deepEqual([hinted.kind, hinted.kind === "unique" ? hinted.plan.id : null], ["unique", floatId]);
  const invented = resolvePlan("We've cancelled the sleigh ride", [fly, sleigh], flyId);
  assert.deepEqual([invented.kind, invented.kind === "unique" ? invented.plan.id : null], ["unique", sleighId], "the words win over a hallucinated id");
  assert.equal(normalizePlanId(`plan:${flyId}`), flyId);
  assert.equal(normalizePlanId("plan:not-a-uuid"), null);
});

test("Contact details are found by code, stay out of the proposal, and are offered only as a labelled option", () => {
  assert.deepEqual(findContactDetails(transcript), ["505-412-7380"]);
  assert.deepEqual(findContactDetails("call +1 (970) 555-0142 or guide@example.test"), ["+1 (970) 555-0142", "guide@example.test"]);
  assert.deepEqual(findContactDetails("Fly fishing 2027-10-12 09:00, booked for 10/12"), [], "dates and times are not phone numbers");
  assert.equal(redactContactDetails(transcript).includes("505"), false);
  assert.equal(planContactOption(transcript, "Guide James"), "Guide James, 505-412-7380");
  assert.equal(planContactOption(transcript, "Guide Robert"), "Contact, 505-412-7380", "a label with words the organizer never used is dropped");
  assert.equal(planContactOption(transcript, "Guide 505"), "Contact, 505-412-7380", "a label cannot carry digits");
  assert.equal(planContactOption("We've confirmed fly fishing", "Guide James"), null);
  const plan = { note: "Meet at the dock", contact: { text: "Guide James, 505-412-7380", include: false } } as TripPlanReview;
  assert.equal(planNoteToSave(plan), "Meet at the dock");
  assert.equal(planNoteToSave({ ...plan, contact: { ...plan.contact!, include: true } }), "Meet at the dock\nGuide James, 505-412-7380");
  assert.equal(planNoteToSave({ ...plan, note: null, contact: { ...plan.contact!, include: true } }), "Guide James, 505-412-7380");
});

test("The Production transcript builds a confirmed status for the right item with the time unchanged and an unchecked contact option", () => {
  const suggestion: PlanSuggestion = { ...none, planId: flyId, planStatus: "confirmed", planStartsOn: "2027-10-12", planStartsTime: "09:00", planContactLabel: "Guide James" };
  const built = buildPlanChange(suggestion, [sleigh, fly], transcript);
  assert.equal(built.kind, "proposal");
  if (built.kind !== "proposal") return;
  assert.deepEqual([built.base.id, built.base.status, built.base.startsOn, built.base.startsTime], [flyId, "planned", "2027-10-12", "09:00"]);
  assert.deepEqual([built.changes.status, built.changes.startsOn, built.changes.startsTime, built.changes.note], ["confirmed", "2027-10-12", "09:00", null]);
  assert.deepEqual(built.changed, { status: true, time: false, note: false });
  assert.deepEqual(built.changes.contact, { text: "Guide James, 505-412-7380", include: false });
  const reply = planProposalReply(built.base, built.changes);
  assert.equal(reply, "Ready to mark “Fly-fishing lesson” confirmed — check the card below. James’s number stays in this conversation unless you add it to the plan note.");
  assert.doesNotMatch(reply, /505|412|7380|Nothing is saved|as reported/, "no number, and no provenance or approval boilerplate the card already shows");
  assert.equal(planProposalReply(built.base, { ...built.changes, status: "cancelled", contact: null }), "Ready to mark “Fly-fishing lesson” cancelled — check the card below.");
  assert.equal(planProposalReply(built.base, { ...built.changes, contact: { text: "Contact, 505-412-7380", include: false } }).split("— check the card below. ")[1], "The number you shared stays in this conversation unless you add it to the plan note.");
  assert.match(planProposalReply(built.base, { ...built.changes, contact: { text: "Front desk, desk@example.com", include: false } }), /Front desk’s email stays in this conversation/);
  assert.equal(planProposalSpokenReply(built.base), "I’ve prepared that plan update for “Fly-fishing lesson”, and approval happens on screen.");
  // A proposal that also moves the time keeps the fuller sentence.
  assert.match(planProposalReply(built.base, { ...built.changes, startsTime: "10:00" }), /I’ve prepared an update to “Fly-fishing lesson” to mark it confirmed, as you reported and move it to Oct 12, 10:00 AM\./);
});

test("A year the model got wrong does not move a plan whose saved month and day were named; a different date needs the words to say so", () => {
  const wrongYear: PlanSuggestion = { ...none, planStatus: "confirmed", planStartsOn: "2026-10-12", planStartsTime: "09:00" };
  const built = buildPlanChange(wrongYear, [fly], transcript);
  assert.equal(built.kind === "proposal" && built.changed.time, false);
  const invented: PlanSuggestion = { ...none, planStatus: "confirmed", planStartsOn: "2027-10-20", planStartsTime: "09:00" };
  const dateNotSaid = buildPlanChange(invented, [fly], transcript);
  assert.equal(dateNotSaid.kind === "proposal" && dateNotSaid.changed.time, false, "10/20 is not in the message");
  const moved = buildPlanChange({ ...none, planStartsOn: "2027-10-14", planStartsTime: "09:00" }, [fly], "Fly fishing moved to 10/14 at 9 AM");
  assert.equal(moved.kind === "proposal" && moved.changes.startsOn, "2027-10-14");
});

test("A start time change is in the item's own timezone, only when the words name the time", () => {
  const changeTo10: PlanSuggestion = { ...none, planStartsTime: "10:00" };
  const built = buildPlanChange(changeTo10, [fly], "fly fishing moved to 10 AM");
  assert.equal(built.kind, "proposal");
  if (built.kind !== "proposal") return;
  assert.deepEqual([built.changes.startsOn, built.changes.startsTime, built.changes.status], ["2027-10-12", "10:00", "planned"]);
  assert.match(planProposalReply(built.base, built.changes), /move it to Oct 12, 10:00 AM/);
  const unsaid = buildPlanChange({ ...none, planStartsTime: "14:00" }, [fly], "fly fishing moved to 10 AM");
  assert.equal(unsaid.kind, "gap", "a time the message never states is ignored, leaving nothing to change");
});

test("Status needs the words: a model that suggests confirmed for a cancellation report is ignored", () => {
  const built = buildPlanChange({ ...none, planStatus: "confirmed" }, [sleigh], "we cancelled the sleigh ride");
  assert.equal(built.kind, "gap");
  const cancelled = buildPlanChange({ ...none, planStatus: "cancelled" }, [sleigh], "we cancelled the sleigh ride");
  assert.equal(cancelled.kind === "proposal" && cancelled.changes.status, "cancelled");
  const already = buildPlanChange({ ...none, planStatus: "confirmed" }, [{ ...fly, status: "confirmed" }], "We've confirmed fly fishing");
  assert.equal(already.kind === "gap" && already.reason, "unchanged");
});

test("A note the model suggests is appended, and never carries a contact detail", () => {
  const added = buildPlanChange({ ...none, planStatus: "confirmed", planNote: "Meet at the north dock." }, [sleigh, fly], "We've confirmed fly fishing. Meet at the north dock.");
  assert.equal(added.kind === "proposal" && added.changes.note, "Meet at the north dock.");
  const withPhone = buildPlanChange({ ...none, planStatus: "confirmed", planNote: "Call the guide at 505-412-7380" }, [fly], transcript);
  assert.equal(withPhone.kind === "proposal" && withPhone.changes.note, null, "a phone number is never placed in the note by the model");
  const appended = buildPlanChange({ ...none, planStatus: "cancelled", planNote: "Rain." }, [sleigh], "we cancelled the sleigh ride");
  assert.equal(appended.kind === "proposal" && appended.changes.note, "Meet at the barn\nRain.");
});

test("A whole trip proposal for a plan never stores a phone number beside the proposal, and old proposals without plan fields still parse", () => {
  const context = { name: "Synthetic trip", startsOn: "2027-10-10", endsOn: "2027-10-14", locationName: "Colorado", targetBudgetCents: null, stays: [], travelers: [], plans: [fly, sleigh] } satisfies TripProposalContext;
  const parsed = parseTripSuggestion({ operations: ["plan"], budgetCents: null, startsOn: null, endsOn: null, locationName: null, stayId: null, stayName: null, stayAddress: null, stayStartsOn: null, stayEndsOn: null,
    stayTotalCents: null, stayBookingUrl: null, stayStatus: null });
  assert.equal(parsed.success, true, "a provider that leaves the plan fields out means no plan values");
  const proposal = buildTripChangeProposal(withReportedPlan(parsed.success ? parsed.data : null, transcript), context, transcript);
  assert.ok(proposal);
  assert.deepEqual(proposal.operations, ["plan"]);
  assert.equal(proposal.source.includes("505"), false);
  assert.match(proposal.source, /\[contact detail\]/);
  assert.equal(JSON.stringify({ ...proposal, changes: { ...proposal.changes, plan: { ...proposal.changes.plan, contact: null } } }).includes("505-412-7380"), false);
  assert.equal(proposal.changes.plan?.status, "confirmed", "the status comes from the words even when the model omitted the plan fields");
  assert.equal(proposal.receipt, null);
});

test("No matching item and several matching items give the code-authored 'nothing to review and nothing was saved' text; a new plan is not created from chat", () => {
  const context = { name: "Synthetic trip", startsOn: null, endsOn: null, locationName: null, targetBudgetCents: null, stays: [], travelers: [], plans: [fly, sleigh] } satisfies TripProposalContext;
  const say = "We confirmed paddleboarding for 9 AM on 10/12. The guide's number is 505-412-7380";
  const suggestion = withReportedPlan(null, say);
  assert.equal(buildTripChangeProposal(suggestion, context, say), null);
  const missing = tripProposalGap(suggestion, context, say);
  assert.match(missing, /nothing to review and nothing was saved/);
  assert.match(missing, /couldn’t find a saved plan that matches/);
  assert.match(missing, /“Fly-fishing lesson”/);
  assert.match(missing, /can’t create a new plan from chat/);
  assert.match(missing, /kept only in this organizer conversation/);
  assert.doesNotMatch(missing, /505/);
  const crowded = { ...context, plans: [fly, { ...fly, id: floatId, title: "Fly-fishing float trip" }] };
  const ambiguous = tripProposalGap(withReportedPlan(null, "We've confirmed fly fishing"), crowded, "We've confirmed fly fishing");
  assert.match(ambiguous, /nothing to review and nothing was saved/);
  assert.match(ambiguous, /More than one saved plan could match \(“Fly-fishing lesson”, “Fly-fishing float trip”\)/);
  assert.match(planGapReply({ kind: "gap", reason: "unchanged", plans: [fly] }, { contact: false }), /already matches what you told me/);
});

test("Only reports about saved plans join the trip-record route; questions and hedges stay answers", () => {
  const saved = [fly, sleigh];
  assert.equal(tripRecordRequestSource(transcript, undefined, saved), transcript);
  assert.equal(tripRecordRequestSource("Should we confirm fly fishing?", undefined, saved), null);
  assert.equal(tripRecordRequestSource("We'll cancel the sleigh ride if it snows", undefined, saved), null);
  assert.equal(tripRecordRequestSource(transcript, undefined, undefined), null, "with no plans supplied the plan route is off");
});

// ---------------------------------------------------------------------------
// Production transcript, "Fly-fishing confirmation": follow-ups that name no plan
// ---------------------------------------------------------------------------

const floatTrip: PlanContextItem = { ...fly, id: floatId, title: "Fly-fishing float trip", startsAt: "2027-10-13T15:00:00.000Z", endsAt: null };
const thread = (messages: string[], threadTitle: string | null = "Fly-fishing confirmation") => ({ messages: messages.map(text => ({ text })), threadTitle });
const flyThread = thread([transcript, "I want to change the activity status to confirmed"]);

test("Fly-fishing transcript: follow-ups that name no plan are recognized, and questions, hedges and other records are not", () => {
  const requests: Array<[string, "confirmed" | "cancelled" | null, boolean]> = [
    ["I want to change the activity status to confirmed", "confirmed", false], ["change the activity status to confirmed", "confirmed", false], ["Mark it confirmed", "confirmed", false],
    ["mark it as confirmed", "confirmed", false], ["Confirm it", "confirmed", false], ["Yes, update the status", null, false], ["yes, go ahead and mark that confirmed", "confirmed", false],
    ["Go ahead and mark that confirmed", "confirmed", false], ["can you mark it confirmed?", "confirmed", false], ["cancel it", "cancelled", false], ["Yes, update it", null, false],
    ["Where is the card?", null, true], ["make the card", null, true], ["Where's the review card", null, true], ["I don't see the card", null, true], ["Where is the suggestion?", null, true]];
  for (const [text, status, wantsCard] of requests) {
    const found = planFollowUpRequest(text);
    assert.notEqual(found, null, text);
    assert.deepEqual([found!.status, found!.wantsCard], [status, wantsCard], text);
  }
  const notRequests = ["Should we confirm it?", "maybe we should mark it confirmed", "We'll mark it confirmed tomorrow", "Did we confirm it?", "Is it confirmed?", "Don't mark it confirmed", "mark it confirmed if the guide calls back",
    "Change the stay status to confirmed", "Mark the lodging confirmed", "Update the budget", "Could we confirm it later?", "What is the status?", "yes", "Make a poll asking if we should confirm it"];
  for (const text of notRequests) assert.equal(planFollowUpRequest(text), null, text);
});

test("Fly-fishing transcript: the plan comes from the recent organizer messages, then the thread title, and only when it is unique", () => {
  const saved = [fly, sleigh];
  // Message 2: the plan is in message 1, and so are the status and the contact.
  const two = resolvePlanFollowUp("I want to change the activity status to confirmed", saved, thread([transcript]));
  assert.equal(two?.kind, "unique");
  if (two?.kind === "unique") assert.deepEqual([two.plan.id, two.status, two.via, two.source], [flyId, "confirmed", "message", `${transcript}\nI want to change the activity status to confirmed`]);
  // Message 3: "Where is the card?" carries no status; it comes from the report the plan was named in.
  const three = resolvePlanFollowUp("Where is the card?", saved, flyThread);
  assert.deepEqual([three?.kind, three?.kind === "unique" && three.status, three?.request.wantsCard], ["unique", "confirmed", true]);
  const yes = resolvePlanFollowUp("yes, update the status", saved, thread([transcript]));
  assert.deepEqual([yes?.kind, yes?.kind === "unique" && yes.status], ["unique", "confirmed"]);
  // Up to the last three organizer messages count; a fourth-oldest does not.
  assert.equal(resolvePlanFollowUp("Mark it confirmed", saved, thread(["what time is fly fishing?", "ok", "thanks", "and lunch?"], null))?.kind, "none");
  assert.equal(resolvePlanFollowUp("Mark it confirmed", saved, thread(["what time is fly fishing?", "ok", "thanks"], null))?.kind, "unique");
  // The thread title is the fallback; a plan named in a message wins over the title.
  const titled = resolvePlanFollowUp("Mark it confirmed", saved, thread(["yes please", "sounds good"], "Fly-fishing confirmation"));
  assert.deepEqual([titled?.kind, titled?.kind === "unique" && titled.via, titled?.kind === "unique" && titled.plan.id], ["unique", "title", flyId]);
  const overridden = resolvePlanFollowUp("Mark it confirmed", saved, thread(["we cancelled the sleigh ride"], "Fly-fishing confirmation"));
  assert.deepEqual([overridden?.kind === "unique" && overridden.plan.id, overridden?.kind === "unique" && overridden.status], [sleighId, "confirmed"], "the request's own status wins");
  // No referent at all.
  assert.equal(resolvePlanFollowUp("Mark it confirmed", saved, thread(["what should we eat?"], "Saturday dinner"))?.kind, "none");
  // The current message may name the plan itself.
  const named = resolvePlanFollowUp("Where is the card for the sleigh ride?", saved, flyThread);
  assert.deepEqual([named?.kind, named && "plan" in named && named.plan.id], ["status_missing", sleighId], "the plan is the sleigh ride, but the earlier report was about fly fishing, so its status is not borrowed");
});

test("Fly-fishing transcript: two fishing plans, or two plans in the recent messages, are one clarification and never a guess", () => {
  const two = resolvePlanFollowUp("change the activity status to confirmed", [fly, floatTrip, sleigh], thread([transcript]));
  assert.equal(two?.kind, "ambiguous");
  if (two?.kind === "ambiguous") assert.deepEqual(two.plans.map(plan => plan.id).sort(), [floatId, flyId].sort());
  const mixed = resolvePlanFollowUp("mark it confirmed", [fly, sleigh], thread([transcript, "and the sleigh ride is at 5?"]));
  assert.equal(mixed?.kind, "ambiguous");
  if (mixed?.kind === "ambiguous") assert.equal(planFollowUpGapReply(mixed, [fly, sleigh]).match(/“[^”]+”/g)?.length, 2);
});

test("Fly-fishing transcript: the status must be explicit in the request or in the earlier report; a settled or hedged earlier message is not evidence", () => {
  const saved = [fly, sleigh];
  const none = resolvePlanFollowUp("yes, update the status", saved, thread(["what time is fly fishing?"]));
  assert.equal(none?.kind, "status_missing");
  if (none?.kind === "status_missing") assert.match(planFollowUpGapReply(none, saved), /can’t tell what status you want for “Fly-fishing lesson”.*mark it confirmed.*mark it cancelled/);
  for (const message of ["We'll confirm fly fishing tomorrow", "Should we confirm fly fishing?", "maybe fly fishing is confirmed"]) assert.equal(resolvePlanFollowUp("yes, update the status", saved, thread([message]))?.kind, "status_missing", message);
  // A review that was already applied or dismissed does not supply a status again.
  assert.equal(resolvePlanFollowUp("yes, update the status", saved, { messages: [{ text: transcript, settled: true }], threadTitle: null })?.kind, "status_missing");
  // A message that reports the opposite is not mixed into the source.
  const opposite = resolvePlanFollowUp("mark it confirmed", saved, thread(["we cancelled the fly-fishing lesson"]));
  assert.deepEqual([opposite?.kind === "unique" && opposite.status, opposite?.kind === "unique" && opposite.source], ["confirmed", "mark it confirmed"]);
  // A cancelled plan is never a referent, and a follow-up with nothing saved has nothing to resolve.
  assert.equal(resolvePlanFollowUp("mark it confirmed", [{ ...fly, status: "cancelled" }], thread([transcript]))?.kind, "none");
});

test("Fly-fishing transcript: routing sends follow-ups to a plan update only when the thread resolves them, and leaves stay and hedged wording alone", () => {
  const saved = [fly, sleigh];
  assert.equal(tripRecordRequestSource("I want to change the activity status to confirmed", undefined, saved, thread([transcript])), `${transcript}\nI want to change the activity status to confirmed`);
  assert.notEqual(tripRecordRequestSource("Where is the card?", undefined, saved, flyThread), null);
  assert.equal(tripRecordRequestSource("Should we confirm it?", undefined, saved, flyThread), null);
  assert.equal(tripRecordRequestSource("maybe mark it confirmed", undefined, saved, flyThread), null);
  assert.equal(tripRecordRequestSource("Mark it confirmed", undefined, saved, thread(["what should we eat?"], "Saturday dinner")), null, "a bare follow-up with no referent is not guessed");
  assert.equal(tripRecordRequestSource("Where is the card?", undefined, saved, thread(["what should we eat?"], "Saturday dinner")), null);
  assert.equal(tripRecordRequestSource("change the activity status to confirmed", undefined, saved, thread(["what should we eat?"], "Saturday dinner")), "change the activity status to confirmed", "it says the activity: answered honestly by code");
  assert.equal(tripRecordRequestSource("Mark the stay confirmed", undefined, saved, flyThread), null);
  assert.equal(tripRecordRequestSource("Mark it confirmed", undefined, undefined, flyThread), null, "with no plans supplied the plan route is off");
  // Existing routes keep their order: a full report or a stay request is unchanged by thread context.
  assert.equal(tripRecordRequestSource(transcript, undefined, saved, flyThread), transcript);
  assert.equal(tripRecordRequestSource("Update the lodging total to $2,100", undefined, saved, flyThread), "Update the lodging total to $2,100");
});

test("Fly-fishing transcript: a follow-up builds the same review as the original report, with the plan and status from the thread, never from the model", () => {
  const context: TripProposalContext = { name: "Synthetic", startsOn: "2027-10-10", endsOn: "2027-10-14", locationName: "Breckenridge", targetBudgetCents: null, stays: [], travelers: [], plans: [fly, sleigh] };
  const source = `${transcript}\nI want to change the activity status to confirmed`;
  const suggestion = parseTripSuggestion({ operations: ["plan"], planId: sleighId, planStatus: "cancelled", planStartsOn: "2027-10-13", planStartsTime: "17:00", planContactLabel: "Guide James", budgetCents: 1000000, startsOn: null, endsOn: null,
    locationName: null, stayId: null, stayName: null, stayAddress: null, stayStartsOn: null, stayEndsOn: null, stayTotalCents: null, stayBookingUrl: null, stayStatus: null, planTitle: null, planNote: null });
  assert.equal(suggestion.success, true);
  const referent = { planId: flyId, status: "confirmed" as const };
  const proposal = buildTripChangeProposal(withPlanReferent(suggestion.success ? suggestion.data : null, referent), context, source, [source], referent);
  assert.deepEqual(proposal?.operations, ["plan"], "a guessed budget is not carried into a plan follow-up");
  assert.deepEqual([proposal?.base.plan?.id, proposal?.changes.plan?.status, proposal?.changes.plan?.startsOn, proposal?.changes.plan?.startsTime, proposal?.changes.plan?.note], [flyId, "confirmed", "2027-10-12", "09:00", null], "the model's other plan and status are ignored; the time is unchanged");
  assert.deepEqual(proposal?.changes.plan?.contact, { text: `Guide James, 505-412-7380`, include: false });
  assert.equal(proposal?.source.includes("505"), false, "the number is not stored beside the proposal");
  // Without the earlier report in the source there is no contact option.
  const bare = buildTripChangeProposal(withPlanReferent(null, referent), context, "Mark it confirmed", ["Mark it confirmed"], referent);
  assert.deepEqual([bare?.changes.plan?.status, bare?.changes.plan?.contact], ["confirmed", null]);
  // Already confirmed as asked: nothing to change, said honestly.
  const done: TripProposalContext = { ...context, plans: [{ ...fly, status: "confirmed" }] };
  assert.equal(buildTripChangeProposal(withPlanReferent(null, referent), done, "Mark it confirmed", ["Mark it confirmed"], referent), null);
  assert.match(tripProposalGap(withPlanReferent(null, referent), done, "Mark it confirmed", referent), /already matches what you told me/);
  // A referent that is not a saved, non-cancelled plan is not guessed at.
  assert.equal(buildTripChangeProposal(withPlanReferent(null, { planId: floatId, status: "confirmed" }), context, "Mark it confirmed", ["Mark it confirmed"], { planId: floatId, status: "confirmed" }), null);
});

test("Fly-fishing transcript: the honest texts say what is true and never describe a review that does not exist", () => {
  assert.equal(planUpdatesOffReply("confirmed"), "Plan updates from chat are turned off right now. You can mark it confirmed in Plan. Nothing was changed.");
  assert.match(planUpdatesOffReply(null), /You can change it in Plan/);
  const waiting = existingPlanReviewReply("Fly-fishing lesson", "confirmed");
  assert.equal(waiting, "A review to mark “Fly-fishing lesson” confirmed is already waiting — check the card on your earlier message.");
  const noReferent = planFollowUpGapReply({ request: { status: "confirmed", wantsCard: false, explicit: true }, kind: "none" }, [fly, sleigh]);
  assert.match(noReferent, /nothing to review and nothing was saved.*can’t tell which plan you mean.*“Fly-fishing lesson”, “Sunset sleigh ride”/);
  for (const text of [waiting, noReferent, planUpdatesOffReply("confirmed")]) assert.doesNotMatch(text, /I['’]ve prepared|I['’]m including|suggested update/);
});

test("A status-only plan proposal is compact; a time change, a note change, another status or a second operation is not; the contact option does not count", () => {
  const base: TripPlanReview = { id: flyId, title: fly.title, status: "planned", timezone: "America/Denver", startsOn: "2027-10-12", startsTime: "09:00", note: null, updatedAt: "2027-01-01T00:00:00.000Z", contact: null };
  const proposal = (over: Partial<TripPlanReview>, operations: Array<"plan" | "stay"> = ["plan"]) => ({ operations, base: { plan: base }, changes: { plan: { ...base, status: "confirmed" as const, ...over } } }) as unknown as Parameters<typeof isCompactPlanProposal>[0];
  assert.equal(isCompactPlanProposal(proposal({})), true);
  assert.equal(isCompactPlanProposal(proposal({ status: "cancelled" })), true);
  assert.equal(isCompactPlanProposal(proposal({ contact: { text: "Guide James, 505-412-7380", include: true } })), true, "the contact option is not a change");
  assert.equal(isCompactPlanProposal(proposal({ startsTime: "10:00" })), false);
  assert.equal(isCompactPlanProposal(proposal({ startsOn: "2027-10-13" })), false);
  assert.equal(isCompactPlanProposal(proposal({ note: "Bring waders" })), false);
  assert.equal(isCompactPlanProposal(proposal({ status: "planned" })), false, "no status change");
  assert.equal(isCompactPlanProposal(proposal({ status: "idea" })), false);
  assert.equal(isCompactPlanProposal(proposal({}, ["plan", "stay"])), false);
  assert.equal(planShortTimeLabel(base), "Oct 12, 9 AM");
  assert.equal(planShortTimeLabel({ ...base, startsTime: "15:30", startsOn: "2027-02-13" }), "Feb 13, 3:30 PM");
  assert.equal(planShortTimeLabel({ ...base, startsOn: null, startsTime: null }), "");
  assert.equal(existingPlanReviewReply("Fly-fishing lesson", "confirmed"), "A review to mark “Fly-fishing lesson” confirmed is already waiting — check the card on your earlier message.");
  assert.equal(existingPlanReviewReply("Sunset sleigh ride", null), "A review for “Sunset sleigh ride” is already waiting — check the card on your earlier message.");
});


test("Relative calendar-day moves use only the saved local schedule, even without model fields", () => {
  const request = "I'd like to move fly fishing up by a day";
  assert.equal(isPlanReport(request, [fly]), true);
  const suggestion = withReportedPlan(null, request)!;
  const built = buildPlanChange({ ...suggestion, planStartsOn: "2040-01-01", planStartsTime: "18:00" }, [fly], request);
  assert.equal(built.kind, "proposal");
  if (built.kind === "proposal") {
    assert.deepEqual([built.changes.startsOn, built.changes.startsTime, built.changes.timezone], ["2027-10-11", "09:00", "America/Denver"]);
    assert.equal(built.changes.status, fly.status);
  }
  for (const text of ["Maybe move fly fishing up by a day", "Don't move fly fishing up by a day", "Should we move fly fishing up by a day?", "Move fly fishing up by a day instead", "Move fly fishing up by 90 days"]) assert.equal(isPlanReport(text, [fly]), false, text);
  const ambiguous = buildPlanChange({ ...suggestion, planId: flyId }, [fly, { ...fly, id: floatId, title: "Fly-fishing float trip" }], request);
  assert.equal(ambiguous.kind === "gap" ? ambiguous.reason : null, "ambiguous", "a model hint cannot disambiguate a relative request");
  const boundary = buildPlanChange(suggestion, [{ ...fly, startsAt: "2027-01-01T16:00:00Z" }], request);
  assert.equal(boundary.kind === "proposal" ? boundary.changes.startsOn : null, "2026-12-31");
  const dst = buildPlanChange(suggestion, [{ ...fly, startsAt: "2027-03-14T15:00:00Z" }], request);
  assert.deepEqual(dst.kind === "proposal" ? [dst.changes.startsOn, dst.changes.startsTime] : [], ["2027-03-13", "09:00"], "calendar shift keeps the local clock across DST");
});

test("Bare acceptance prepares only the last unresolved organizer request in this conversation", () => {
  const request = "I'd like to move fly fishing up by a day";
  const context = { messages: [{ text: request }], threadTitle: null };
  assert.equal(tripRecordRequestSource("Yes", request, [fly], context), `${request}\nYes`);
  assert.equal(tripRecordRequestSource("Yes", request, [fly], { ...context, messages: [{ text: request, settled: true }] }), null);
  assert.equal(tripRecordRequestSource("Yes", "What about lunch?", [fly], { ...context, messages: [...context.messages, { text: "What about lunch?" }] }), null);
  assert.equal(tripRecordRequestSource("Yes", request, [fly], { ...context, messages: [] }), null);
  assert.equal(tripRecordRequestSource("No", request, [fly], context), null);
});
