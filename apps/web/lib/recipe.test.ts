import assert from "node:assert/strict";
import test from "node:test";
import {
  CreatePollRequestSchema, PollWorkingDataSchema, buildDatesLocationPollData, datesLocationQuestions, deriveRecipeStage,
  summarizeAlternatives, alternativesFromQuestions, outcomeDrift, formatAlternativeLabel, recipeCatalog, recipeForWorkflowKey,
  workflowDraftingContract, DatesLocationAlternativesSchema, ApplyRecipeOutcomeSchema, type DatesLocationAlternative,
  attendanceQuestions, buildAttendancePollData, summarizeAttendance, buildLodgingPollData, lodgingQuestions, summarizeLodging, propertiesFromQuestions, outcomeStaleness,
  LodgingPropertiesSchema, formatEstimate, PollPropertySchema, type LodgingPropertyInput, type RecipeOutcome,
  proposeTransferGroups, formatTransferWindow, type TransportLeg,
} from "@commons/contracts";

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const napa: DatesLocationAlternative = { id: id(1), startsOn: "2026-11-05", endsOn: "2026-11-07", place: "Napa" };
const sonoma: DatesLocationAlternative = { id: id(2), startsOn: "2026-11-12", endsOn: "2026-11-14", place: "Sonoma" };
const paso: DatesLocationAlternative = { id: id(3), startsOn: "2026-11-05", endsOn: "2026-11-07", place: "Paso Robles" };

test("every guided recipe maps to a stable internal workflow key that still exists", () => {
  assert.equal(recipeForWorkflowKey("trip_feasibility")?.id, "dates_location");
  for (const entry of recipeCatalog.filter(item => item.handler === "poll_draft")) assert.equal(workflowDraftingContract(entry.workflowKey === "trip_feasibility" ? "trip_feasibility" : entry.workflowKey as never).authority, "private_draft_only");
});

test("date-and-place poll is deterministic, combined and publishable", () => {
  const data = buildDatesLocationPollData({ alternatives: [napa, sonoma, paso] });
  PollWorkingDataSchema.parse(data);
  const [acceptable, preferred] = data.questions;
  assert.equal(acceptable.kind === "choice" && acceptable.selectionMode, "multiple");
  assert.equal(preferred.kind === "choice" && preferred.selectionMode, "single");
  if (acceptable.kind !== "choice" || preferred.kind !== "choice") throw new Error("expected choice questions");
  // Exactly one mutually exclusive neither, and none in the preference question.
  assert.equal(acceptable.options.filter(option => option.exclusive).length, 1);
  assert.equal(preferred.options.some(option => option.exclusive), false);
  // Alternative identity is shared by both questions so the two answers refer to the same combination.
  assert.deepEqual(acceptable.options.filter(option => option.alternative).map(option => option.id), preferred.options.map(option => option.id));
  assert.deepEqual(alternativesFromQuestions(data.questions), [napa, sonoma, paso]);
  const request = CreatePollRequestSchema.parse({ commandId: id(9), draftId: id(8), draftVersion: 1, publicationApproval: { approved: true }, title: data.title, intro: data.intro, ballotMode: data.ballotMode, questions: data.questions });
  assert.equal(request.questions.length, 2);
});

test("editing alternatives keeps question identity so open answers and links survive an edit", () => {
  const first = buildDatesLocationPollData({ alternatives: [napa, sonoma] });
  const second = buildDatesLocationPollData({ alternatives: [napa, sonoma, paso], previous: first });
  assert.deepEqual(second.questions.map(question => question.id), first.questions.map(question => question.id));
  const neither = (data: typeof first) => data.questions[0].kind === "choice" ? data.questions[0].options.find(option => option.exclusive)!.id : "";
  assert.equal(neither(second), neither(first));
});

test("a hand-edited label that no longer matches the typed alternative is rejected", () => {
  const data = buildDatesLocationPollData({ alternatives: [napa, sonoma] });
  const forged = structuredClone(data);
  if (forged.questions[0].kind !== "choice") throw new Error("expected choice");
  forged.questions[0].options[0].label = "Thu, Nov 5 – Sat, Nov 7 · Somewhere cheaper";
  assert.throws(() => CreatePollRequestSchema.parse({ commandId: id(9), draftId: id(8), draftVersion: 1, publicationApproval: { approved: true }, title: "t", intro: null, ballotMode: "transparent", questions: forged.questions }), /labels/);
});

test("alternatives need two distinct, ordered, bounded options", () => {
  assert.throws(() => DatesLocationAlternativesSchema.parse([napa]));
  assert.throws(() => DatesLocationAlternativesSchema.parse([napa, { ...napa, id: id(4) }]), /different/);
  assert.throws(() => DatesLocationAlternativesSchema.parse([napa, { ...sonoma, endsOn: "2026-11-01" }]), /end date/);
  assert.equal(formatAlternativeLabel(napa), "Thu, Nov 5, 2026 – Sat, Nov 7, 2026 · Napa");
});

const audience = [{ key: "a", name: "Ana" }, { key: "b", name: "Ben" }, { key: "c", name: "Cy" }];
test("overlap summary never counts silence and never combines independent majorities", () => {
  const summary = summarizeAlternatives({ alternatives: [napa, sonoma], audience, responses: [
    { key: "a", name: "Ana", acceptable: [napa.id, sonoma.id], neither: false, preferred: napa.id, hasNeed: false },
    { key: "b", name: "Ben", acceptable: [napa.id], neither: false, preferred: null, hasNeed: true },
  ] });
  assert.deepEqual(summary.awaiting, ["Cy"]);
  assert.equal(summary.respondedCount, 2); assert.equal(summary.askedCount, 3);
  const [n, s] = summary.rows;
  assert.deepEqual(n.acceptedBy, ["Ana", "Ben"]); assert.equal(n.worksForAllWhoAnswered, true);
  // Cy has not answered, so no option works for everyone asked.
  assert.equal(n.worksForEveryoneAsked, false);
  assert.deepEqual(s.notAcceptedBy, ["Ben"]); assert.equal(s.worksForAllWhoAnswered, false);
  assert.deepEqual(n.preferredBy, ["Ana"]); assert.equal(summary.needsNoted, 1);
});

test("everyone asked has to answer before an option works for everyone", () => {
  const all = audience.map(person => ({ ...person, acceptable: [paso.id], neither: false, preferred: paso.id, hasNeed: false }));
  const summary = summarizeAlternatives({ alternatives: [paso], audience, responses: all });
  assert.equal(summary.rows[0].worksForEveryoneAsked, true); assert.deepEqual(summary.awaiting, []);
});

test("an explicit neither is reported separately from silence and from other options", () => {
  const summary = summarizeAlternatives({ alternatives: [napa], audience, responses: [{ key: "a", name: "Ana", acceptable: [], neither: true, preferred: null, hasNeed: false }] });
  assert.equal(summary.neitherCount, 1); assert.deepEqual(summary.neitherBy, ["Ana"]); assert.deepEqual(summary.awaiting, ["Ben", "Cy"]);
  assert.equal(summary.rows[0].worksForAllWhoAnswered, false);
});

test("a poll with no responses is shared, not decided", () => {
  const summary = summarizeAlternatives({ alternatives: [napa], audience, responses: [] });
  assert.equal(summary.rows[0].worksForAllWhoAnswered, false); assert.equal(summary.awaiting.length, 3);
});

test("stage derivation follows the underlying records and never invents progress", () => {
  const draft = { archived: false, publishedPollId: null };
  assert.equal(deriveRecipeStage({ draft, poll: null, outcome: null }), "draft");
  assert.equal(deriveRecipeStage({ draft: null, poll: null, outcome: null }), "draft");
  assert.equal(deriveRecipeStage({ draft, poll: { status: "open", responseCount: 0, superseded: false }, outcome: null }), "shared");
  assert.equal(deriveRecipeStage({ draft, poll: { status: "open", responseCount: 2, superseded: false }, outcome: null }), "collecting");
  assert.equal(deriveRecipeStage({ draft, poll: { status: "closed", responseCount: 2, superseded: false }, outcome: null }), "decide");
  assert.equal(deriveRecipeStage({ draft, poll: { status: "closed", responseCount: 2, superseded: true }, outcome: null }), "closed");
  assert.equal(deriveRecipeStage({ draft, poll: { status: "closed", responseCount: 2, superseded: false }, outcome: { status: "approved" } }), "decided");
  assert.equal(deriveRecipeStage({ draft, poll: { status: "closed", responseCount: 2, superseded: false }, outcome: { status: "applied" } }), "applied");
  // A superseded outcome does not make a closed round look decided.
  assert.equal(deriveRecipeStage({ draft, poll: { status: "closed", responseCount: 2, superseded: false }, outcome: { status: "superseded" } }), "decide");
});

test("drift is scoped to the fields the outcome owns", () => {
  const outcome = { kind: "dates_location" as const, alternativeId: id(1), startsOn: "2026-11-05", endsOn: "2026-11-07", place: "Napa", exceptions: [], basis: { respondedCount: 2, askedCount: 3, awaitingCount: 1, acceptedCount: 2, preferredCount: 1 } };
  const trip = { startsOn: "2026-11-05", endsOn: "2026-11-07", locationNames: ["napa"] };
  assert.deepEqual(outcomeDrift(outcome, { dates: true, location: true }, trip), []);
  assert.deepEqual(outcomeDrift(outcome, { dates: true, location: true }, { ...trip, endsOn: "2026-11-08" }), ["dates"]);
  assert.deepEqual(outcomeDrift(outcome, { dates: true, location: false }, { ...trip, locationNames: ["Elsewhere"] }), []);
  assert.deepEqual(outcomeDrift(outcome, { dates: false, location: true }, { ...trip, locationNames: ["Elsewhere"] }), ["location"]);
});

test("applying needs at least one explicit target", () => {
  assert.throws(() => ApplyRecipeOutcomeSchema.parse({ commandId: id(5), outcomeId: id(6), expected: { startsOn: null, endsOn: null, locationNames: [] }, applyDates: false, applyLocation: false }));
});

test("question lookup finds the acceptable and preference questions", () => {
  const data = buildDatesLocationPollData({ alternatives: [napa, sonoma] });
  const found = datesLocationQuestions(data.questions);
  assert.equal(found?.acceptable.selectionMode, "multiple"); assert.equal(found?.preferred?.selectionMode, "single");
  assert.equal(datesLocationQuestions([]), null);
});

/* ---------- Attendance ---------- */

const trip = { startsOn: "2027-04-15", endsOn: "2027-04-17", locationNames: ["Napa"] };
const person = (key: string, name: string) => ({ key, name });
const fact = (key: string, name: string, state: "in" | "maybe" | "out" | null, partySize: number | null = null, guest = false, responseId = `r-${key}`) => ({ key, name, responseId, guest, state, partySize, note: null, hasNeed: false });

test("attendance poll states the dates and place and promises no RSVP change", () => {
  const data = buildAttendancePollData({ trip });
  PollWorkingDataSchema.parse(data);
  assert.match(data.intro ?? "", /Apr 15–17, 2027 in Napa/); assert.match(data.intro ?? "", /doesn’t accept an invitation or change your RSVP/);
  const found = attendanceQuestions(data.questions)!;
  assert.deepEqual(found.state.options.map(option => option.attendance), ["in", "maybe", "out"]);
  CreatePollRequestSchema.parse({ commandId: id(9), draftId: id(8), draftVersion: 1, publicationApproval: { approved: true }, title: data.title, intro: data.intro, ballotMode: "transparent", questions: data.questions });
  const rebuilt = buildAttendancePollData({ trip, previous: data });
  assert.deepEqual(rebuilt.questions.map(question => question.id), data.questions.map(question => question.id), "edits keep question identity");
  const forged = structuredClone(data);
  if (forged.questions[0].kind !== "choice") throw new Error("choice");
  forged.questions[0].options[0].label = "Definitely";
  assert.throws(() => CreatePollRequestSchema.parse({ commandId: id(9), draftId: id(8), draftVersion: 1, publicationApproval: { approved: true }, title: "t", intro: null, ballotMode: "transparent", questions: forged.questions }), /attendance answers/);
});

test("attendance summary: own answer wins, silence is its own state, party sizes are never invented", () => {
  const summary = summarizeAttendance({ audience: [person("a", "Ana"), person("b", "Ben"), person("c", "Cy"), person("d", "Dee")],
    responses: [fact("a", "Ana", "in", 3), fact("b", "Ben", "maybe")],
    entries: [{ key: "b", name: "Ben", state: "out", partySize: null, note: null, enteredBy: "Olive" }, { key: "c", name: "Cy", state: "in", partySize: 2, note: "By phone", enteredBy: "Olive" }] });
  assert.deepEqual(summary.counts, { in: 2, maybe: 1, out: 0, unanswered: 1 });
  assert.deepEqual(summary.headcount, { in: 5, maybe: 1, assumedOne: ["Ben"] });
  assert.deepEqual(summary.superseded, ["Ben"], "an organizer's note never replaces the person's own answer");
  assert.equal(summary.people.find(item => item.name === "Cy")?.source, "organizer_entered");
  assert.equal(summary.people.find(item => item.name === "Dee")?.state, "unanswered");
});

test("guests who share a name are never merged, and excluding one is an explicit choice", () => {
  const responses = [fact("guest:sam", "Sam", "in", 2, true, "r1"), fact("guest:sam", "Sam", "maybe", 1, true, "r2"), fact("guest:pat", "Pat", "out", null, true, "r3")];
  const open = summarizeAttendance({ audience: [], responses, entries: [] });
  assert.deepEqual(open.duplicates, [{ name: "Sam", responseIds: ["r1", "r2"], answers: [{ responseId: "r1", state: "in", partySize: 2 }, { responseId: "r2", state: "maybe", partySize: 1 }] }]);
  const resolved = summarizeAttendance({ audience: [], responses, entries: [], excludedResponseIds: ["r2"] });
  assert.deepEqual(resolved.duplicates, []); assert.deepEqual(resolved.counts, { in: 1, maybe: 0, out: 1, unanswered: 0 });
});

/* ---------- Lodging ---------- */
const price = { basis: "per_room" as const, period: "nightly" as const, currency: "USD", minCents: 28000, maxCents: 34000, fees: "unknown" as const };
const inn: LodgingPropertyInput = { id: id(1), name: "Vineyard Inn", url: "https://example.com/inn", description: "Walkable", rooms: "Six king rooms", beds: "king_only", pricing: price };
const house: LodgingPropertyInput = { id: id(2), name: "Valley House", url: "https://example.com/house", description: null, rooms: "Two twin rooms", beds: "separate_beds_available", pricing: { ...price, minCents: null, maxCents: null } };

test("lodging poll needs supplied links and keeps estimates distinct from quotes", () => {
  assert.throws(() => LodgingPropertiesSchema.parse([inn]), /at least two/);
  assert.throws(() => LodgingPropertiesSchema.parse([inn, { ...house, url: "ftp://nope" }]));
  assert.throws(() => LodgingPropertiesSchema.parse([inn, { ...house, url: inn.url }]), /own link/);
  assert.throws(() => PollPropertySchema.parse({ rooms: "x", beds: "unknown", pricing: { ...price, minCents: 50000, maxCents: 100 } }), /above the high end/);
  assert.equal(formatEstimate(price), "Organizer’s estimate: $280–$340 per room, per night; fees unknown. Not a quote.");
  assert.equal(formatEstimate({ ...price, minCents: null, maxCents: null }), "Price unknown");
  const data = buildLodgingPollData({ properties: [inn, house], trip, askAboutChildren: true });
  PollWorkingDataSchema.parse(data);
  const found = lodgingQuestions(data.questions)!;
  assert.ok(found.sleeping && found.children && found.preferred);
  assert.deepEqual(propertiesFromQuestions(data.questions).map(item => item.name), ["Vineyard Inn", "Valley House"]);
  assert.equal(lodgingQuestions(buildLodgingPollData({ properties: [inn, house], trip }).questions)?.children, null, "the children question only appears when it is relevant");
  CreatePollRequestSchema.parse({ commandId: id(9), draftId: id(8), draftVersion: 1, publicationApproval: { approved: true }, title: data.title, intro: data.intro, ballotMode: "transparent", questions: data.questions });
  assert.ok(!JSON.stringify(data).includes("totalCents"), "supplied estimates never ride on the quoted-housing representation");
});

test("lodging summary surfaces bed conflicts before anything is approved", () => {
  const responses = [
    { key: "a", name: "Ana", acceptable: [inn.id, house.id], neither: false, preferred: inn.id, sleeping: "own_bed" as const, children: true, hasNeed: false },
    { key: "b", name: "Ben", acceptable: [inn.id], neither: false, preferred: null, sleeping: "share_bed" as const, children: false, hasNeed: false },
  ];
  const summary = summarizeLodging({ properties: [inn, house, { ...house, id: id(3), name: "Mystery", beds: "unknown" }], responses, audience: [person("a", "Ana"), person("b", "Ben"), person("c", "Cy")] });
  assert.match(summary.rows[0].conflicts[0], /Ana asked for their own bed or separate beds, and this place lists only king beds/);
  assert.deepEqual(summary.rows[1].conflicts, []);
  assert.deepEqual(summary.awaiting, ["Cy"]); assert.deepEqual(summary.childrenYes, ["Ana"]);
  const unknownBeds = summarizeLodging({ properties: [{ ...house, beds: "unknown" }], responses, audience: [] });
  assert.match(unknownBeds.rows[0].conflicts[0], /Bed setup isn’t listed/);
});

/* ---------- Staleness ---------- */
const attendanceResult: RecipeOutcome = { kind: "attendance", counts: { in: 3, maybe: 1, out: 0, unanswered: 0 }, headcount: { in: 3, maybe: 1 }, people: [], exceptions: [], excludedResponses: 0, basedOn: trip };
const lodgingResult: RecipeOutcome = { kind: "lodging", optionId: id(1), name: "Inn", url: "https://example.com", rooms: "r", beds: "unknown", pricing: "Price unknown", acceptedCount: 1, preferredCount: 1, respondedCount: 2, awaitingCount: 0,
  conflictsAcknowledged: [], exceptions: [], basedOn: { trip, attendanceOutcomeId: id(4), headcountIn: 3, headcountMaybe: 1 } };
test("staleness is scoped to what each result depended on and never touches a superseded result", () => {
  const now = { trip, attendance: { outcomeId: id(4), headcountIn: 3, headcountMaybe: 1 } };
  const approved = (result: RecipeOutcome) => ({ status: "approved" as const, result, appliedTargets: null });
  assert.deepEqual(outcomeStaleness(approved(attendanceResult), now), []); assert.deepEqual(outcomeStaleness(approved(lodgingResult), now), []);
  assert.deepEqual(outcomeStaleness(approved(attendanceResult), { ...now, trip: { ...trip, endsOn: "2027-04-18" } }).map(item => item.field), ["dates"]);
  assert.deepEqual(outcomeStaleness(approved(attendanceResult), { ...now, trip: { ...trip, locationNames: ["Sonoma"] } }).map(item => item.field), ["location"]);
  assert.deepEqual(outcomeStaleness(approved(lodgingResult), { ...now, trip: { ...trip, locationNames: ["Sonoma"] } }), [], "lodging does not depend on the place name");
  assert.deepEqual(outcomeStaleness(approved(lodgingResult), { ...now, attendance: { outcomeId: id(5), headcountIn: 4, headcountMaybe: 0 } }).map(item => item.field), ["headcount"]);
  assert.deepEqual(outcomeStaleness(approved(lodgingResult), { ...now, attendance: { outcomeId: id(5), headcountIn: 3, headcountMaybe: 2 } }).map(item => item.field), ["headcount"], "changed tentative attendance and a successor decision require review too");
  assert.deepEqual(outcomeStaleness(approved(lodgingResult), { ...now, attendance: null }).map(item => item.field), ["headcount"]);
  assert.deepEqual(outcomeStaleness({ status: "superseded", result: attendanceResult, appliedTargets: null }, { ...now, trip: { ...trip, endsOn: "2030-01-01" } }), []);
});

/* ---------- Transport ---------- */
const leg = (name: string, place: string | null, date: string | null, time: string | null, extra: Partial<TransportLeg> = {}): TransportLeg => ({ personId: `p-${name}`, name, direction: "arrival", place, date, time, timezone: "America/Los_Angeles", provisional: false, ...extra });
const tz = "America/Los_Angeles";

test("rides group only people at the same place inside the window, and say what they assumed", () => {
  const proposal = proposeTransferGroups({ tripTimezone: tz, legs: [leg("Ana", "SFO", "2027-04-15", "15:10"), leg("Ben", "sfo ", "2027-04-15", "16:05"), leg("Cy", "SFO", "2027-04-15", "16:20"), leg("Dee", "OAK", "2027-04-15", "15:15")] });
  assert.deepEqual(proposal.groups.map(group => group.members.map(member => member.name)), [["Ana", "Ben"]], "Cy lands 70 minutes after Ana, so the window ends; OAK is separate");
  assert.deepEqual(proposal.places.map(item => [item.place, item.names]).sort(), [["OAK", ["Dee"]], ["SFO", ["Ana", "Ben", "Cy"]]]);
  assert.match(proposal.assumptions.join(" "), /isn’t a pickup time/); assert.match(proposal.assumptions.join(" "), /Nothing is estimated about driving time, luggage or vehicle size/);
  assert.equal(formatTransferWindow(proposal.groups[0]), "3:10 PM–4:05 PM");
});

test("midnight and date changes use real instants, not clock strings", () => {
  const proposal = proposeTransferGroups({ tripTimezone: tz, legs: [leg("Dee", "SFO", "2027-04-15", "23:50"), leg("Eve", "SFO", "2027-04-16", "00:20"), leg("Fay", "SFO", "2027-04-16", "23:50")] });
  assert.equal(proposal.groups.length, 1); assert.deepEqual(proposal.groups[0].dates, ["2027-04-15", "2027-04-16"]);
  assert.match(formatTransferWindow(proposal.groups[0]), /\(2 different days\)/);
  // The same clock time a day apart never groups.
  assert.equal(proposeTransferGroups({ tripTimezone: tz, legs: [leg("A", "SFO", "2027-04-15", "10:00"), leg("B", "SFO", "2027-04-16", "10:00")] }).groups.length, 0);
});

test("daylight saving and different zones compare as instants", () => {
  // 2027-03-14 02:30 doesn't exist in Los Angeles; a flight in New York at 05:30 is 02:30 Pacific-standard-equivalent, so only valid zones group.
  const proposal = proposeTransferGroups({ tripTimezone: tz, legs: [leg("A", "SFO", "2027-04-15", "12:00", { timezone: "America/Los_Angeles" }), leg("B", "SFO", "2027-04-15", "15:30", { timezone: "America/New_York" })] });
  assert.equal(proposal.groups.length, 1, "15:30 in New York is 12:30 in Los Angeles");
  assert.equal(proposal.groups[0].assumedTimezone, false);
});

test("missing details are listed, never guessed, and unusable zone labels fall back to the trip zone openly", () => {
  const proposal = proposeTransferGroups({ tripTimezone: tz, roster: [{ personId: "p-Ana", name: "Ana" }, { personId: "p-Gus", name: "Gus" }],
    legs: [leg("Ana", "SFO", "2027-04-15", "15:10", { timezone: "PT" }), leg("Ben", "SFO", "2027-04-15", "15:40", { timezone: null }), leg("Cy", null, "2027-04-15", "15:20"), leg("Dee", "SFO", null, null), leg("Eve", "SFO", "2027-02-30", "10:00")] });
  assert.equal(proposal.groups.length, 1); assert.equal(proposal.groups[0].assumedTimezone, true);
  assert.deepEqual(proposal.needsDetails.map(item => [item.name, item.missing]).sort(), [["Cy", ["place"]], ["Dee", ["date", "time"]], ["Eve", ["date"]]]);
  assert.deepEqual(proposal.noFlight.filter(item => item.name === "Gus").map(item => item.direction).sort(), ["arrival", "departure"]);
});

test("unconfirmed travelers are counted apart and return legs never mix with arrivals", () => {
  const proposal = proposeTransferGroups({ tripTimezone: tz, legs: [leg("Ana", "SFO", "2027-04-17", "11:00", { direction: "departure" }), leg("Ben", "SFO", "2027-04-17", "11:20", { direction: "departure", provisional: true }), leg("Ana", "SFO", "2027-04-17", "11:10")] });
  assert.equal(proposal.groups.length, 1);
  assert.deepEqual([proposal.groups[0].direction, proposal.groups[0].confirmedCount, proposal.groups[0].provisionalCount], ["departure", 1, 1]);
  assert.equal(proposeTransferGroups({ tripTimezone: tz, windowMinutes: 1, legs: [leg("A", "SFO", "2027-04-17", "11:00"), leg("B", "SFO", "2027-04-17", "11:10")] }).windowMinutes, 15, "the window is bounded");
});
