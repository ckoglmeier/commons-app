import "../test-support/stub-server-only";
import { quickRecommendationQuery } from "./coordinator-recommendation";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CapabilityIdSchema, coordinatorCapabilityRegistry, RoutedIntentSchema, TripContextSnapshotSchema, type RoutedIntent, type ThreadIndexEntry, type TripContextSnapshot } from "@commons/contracts";
import { derivedIdSeed, derivedUuid, isExplicitPollRequest, isExplicitResearchRequest, isFactLookup, isModelFreeRequest, routeCoordinatorIntent, spokenSummary, unsupportedReasonFor, type RouteInput } from "./coordinator-routing";
import { parseLinkIdea, parseThreadNavigation, parseThreadReference, resolveIdea, resolveThreadReference } from "./coordinator-thread-index";
import { buildPublicResearchQuery, sanitizeTypedResearchQuery, sanitizePublicLodgingQuery } from "./coordinator-research-query";

// Pure routing, parsing, resolution and query-sanitizing tests for Stage 4. Behavior against the database and
// routes is in coordinator-capabilities.integration.test.ts (named after the acceptance scenarios).

const now = new Date("2027-01-10T12:00:00Z").toISOString();
const ids = { casey: randomUUID(), robin: randomUUID(), taylor: randomUUID(), stay: randomUUID(), idea: randomUUID(), idea2: randomUUID() };
const thread = (title: string, over: Partial<ThreadIndexEntry> = {}): ThreadIndexEntry => ({ threadId: randomUUID(), title, status: "active", summary: null, summaryTurnVersion: null, turnVersion: 1, openQuestions: [], approvedOutcomes: [],
  artifactCounts: { drafts: 0, polls: 0, research: 0, linkedIdeas: 0 }, lastActivityAt: now, ...over });
const fact = <T>(id: string, value: T, recordType: string = "trip") => ({ id, version: 1, provenance: { kind: "saved_record" as const, recordType, recordId: null, threadId: null, label: null }, freshness: { asOf: now, updatedAt: now }, value });

function snapshot(threads: ThreadIndexEntry[] = [], over: Partial<TripContextSnapshot> = {}): TripContextSnapshot {
  return TripContextSnapshotSchema.parse({
    schemaVersion: 1, tripId: randomUUID(), assembledAt: now, audience: "active_organizers",
    trip: fact("trip", { name: "Synthetic Breckenridge weekend", destination: "Breckenridge, Colorado", startsOn: "2027-02-12", endsOn: "2027-02-15", timezone: "America/Denver" }),
    travelers: [["Casey Synthetic", ids.casey], ["Robin Synthetic", ids.robin], ["Taylor Synthetic", ids.taylor]].map(([name, personId]) => fact(`traveler:${personId}`, { personId, name, role: "member", membership: "active", managed: false, attendance: "unknown", attendanceDates: null }, "membership")),
    stays: [fact(`stay:${ids.stay}`, { stayId: ids.stay, name: "Synthetic Peak Lodge", address: "100 Synthetic Ridge Rd, Breckenridge, CO", startsOn: "2027-02-12", endsOn: "2027-02-15", checkInTime: null, checkOutTime: null, status: "confirmed", bookingReportedByOrganizer: true, availabilityVerified: false, costCents: 184000, costKind: "confirmation", currency: "USD", includedPersonIds: [] }, "stay")],
    plans: [fact(`plan:${ids.idea}`, { itemId: ids.idea, title: "Ski lesson", status: "idea", startsAt: null, location: null, participantScope: "everyone" }, "itinerary_item"),
      fact(`plan:${ids.idea2}`, { itemId: ids.idea2, title: "Ski rental", status: "idea", startsAt: null, location: null, participantScope: "everyone" }, "itinerary_item")],
    logistics: [], budget: fact("budget", { targetTotalCents: null, recordedExpenseTotalCents: 0, recordedExpenseCount: 0, currency: "USD" }, "budget"),
    polls: [], pendingProposals: [], threads, capabilities: ["answer"], unknowns: [], ...over,
  });
}

const flags = { tripChangesEnabled: true, researchConfigured: true };
function route(text: string, over: Partial<RouteInput> = {}, threads: ThreadIndexEntry[] = [], activeIndex = 0): RoutedIntent {
  const list = threads.length ? threads : [thread("Saturday dinner")];
  return routeCoordinatorIntent({ text, draftSelected: false, snapshot: snapshot(list), activeThreadId: list[activeIndex].threadId, flags, inputMode: "text", ...over });
}

test("named expense conversion is a model-free review and explicit poll actions keep priority", async () => {
  assert.deepEqual(route("Convert Ski lesson to an expense"), { capability: "prepare_expense" });
  assert.equal(isModelFreeRequest("Convert Ski lesson to an expense", undefined, true), true);
  assert.equal(route("Convert Ski lesson to an expense", { explicitAction: { kind: "ask_group", starterId: "question" } }).capability, "prepare_poll");
  const { dispatchCapability } = await import("./coordinator-capabilities");
  const context = snapshot([]);
  const input: Parameters<typeof dispatchCapability>[1] = { prompt: "Convert Ski lesson to an expense", slug: "test", commandId: randomUUID(), inputMode: "text", contextKey: "test", threadId: null, thread: { version: 0, turns: [], hasEarlier: false, threads: [], linkedIdeas: [], researchRuns: [], drafts: [], polls: [] }, wantTopicTitle: false, wantThreadSummary: false, draft: null, draftSelected: false, context: { snapshot: context, json: JSON.stringify(context), sources: [], truncated: false } };
  const result = await dispatchCapability({ capability: "prepare_expense" }, input);
  assert.equal(result.modelTier, "none");
  assert.equal(result.model, null);
  assert.deepEqual(result.workspace.expenseReview, { planId: ids.idea, title: "Ski lesson" });
  assert.match(result.assistantText, /Nothing has been recorded/);
  assert.equal(result.newDraft, undefined);
  assert.equal(result.data, null);
  const ambiguous = await dispatchCapability({ capability: "prepare_expense" }, { ...input, context: { ...input.context, snapshot: { ...context, plans: [context.plans[0], context.plans[0]] } } });
  assert.equal(ambiguous.workspace.expenseReview, undefined);
});

test("private itinerary refinement precedes saved-plan inference without absorbing other actions", () => {
  const editable = { itineraryDocumentEditable: true };
  for (const text of [
    "Revise this same itinerary, not a new one. Make it warmer and about half as long. Simplify Saturday to a relaxed Sonoma morning, then SFO by 1:30 pm for the 4:24 pm flight. Do not create tasks or change any saved trip records.",
    "Simplify Saturday", "Rewrite this as a warm, concise outline", "Update the itinerary opening",
  ]) assert.equal(route(text, editable).capability, "research", text);
  for (const text of ["Update our stay: total lodging cost is $2,100.", "Change the trip dates to November 5–7", "Make a poll asking where to eat", "What is our hotel address?", "Book it", "Email the group the plan", "Should we simplify Saturday?", "Don't revise the itinerary"]) {
    assert.deepEqual(route(text, editable), route(text), text);
  }
  assert.notEqual(route("Revise this same itinerary. Simplify Saturday", { itineraryDocumentEditable: false }).capability, "research");
});

test("the registry and router agree, direct human commands are bounded, and model proposals require review", () => {
  assert.deepEqual(Object.keys(coordinatorCapabilityRegistry).sort(), [...CapabilityIdSchema.options].sort());
  assert.deepEqual(Object.values(coordinatorCapabilityRegistry).filter(entry => entry.effect === "direct_with_undo").map(entry => entry.id), ["record_attendance"]);
  for (const entry of Object.values(coordinatorCapabilityRegistry)) if (entry.effect === "proposal") assert.equal(entry.reviewRequired, true);
  // Cheap tasks route to the cheap tier; synthesis stays with the stronger one.
  assert.deepEqual([coordinatorCapabilityRegistry.navigate_thread.modelTier, coordinatorCapabilityRegistry.record_attendance.modelTier, coordinatorCapabilityRegistry.retrieve_context.modelTier, coordinatorCapabilityRegistry.propose_trip_change.modelTier, coordinatorCapabilityRegistry.research.modelTier], ["none", "none", "extraction", "extraction", "synthesis"]);
  const routed: Array<[string, RoutedIntent["capability"]]> = [
    ["Where should the family eat dinner around 5 p.m.?", "answer"], ["I am attending the trip.", "record_attendance"], ["Update our stay: total lodging cost is $2,100.", "propose_trip_change"],
    ["Make a poll asking where to eat on Saturday", "prepare_poll"], ["Look up kid-friendly dinner spots", "research"], ["Book it", "unsupported"], ["continue this in lodging", "navigate_thread"],
    ["What's our lodging address?", "retrieve_context"], ["Link the ski lesson idea to this thread", "link_idea"],
  ];
  for (const [text, capability] of routed) {
    const intent = route(text, {}, [thread("Saturday dinner"), thread("Lodging costs")]);
    assert.equal(intent.capability, capability, text);
    assert.equal(RoutedIntentSchema.safeParse(intent).success, true, `${text} routes to a valid intent`);
  }
});

test("Start a new restaurant topic: ordinary advice, questions about polls, and group wording never route to poll preparation", () => {
  for (const text of ["Where should the family eat Saturday?", "How does a poll work?", "What did the poll say about lodging?", "Would the group like early seating?", "Anyone in the group vegetarian?", "Let's think about the group dinner", "The poll closed yesterday, what's next for dinner?"]) {
    assert.equal(route(text).capability, "answer", text);
    assert.equal(isExplicitPollRequest(text), false, text);
  }
  for (const text of ["Make a poll asking where to eat", "Please prepare a poll for the group about dinner", "Can you poll the group on Saturday plans?", "Ask the group where they want to eat", "Let's get the group's input on lodging", "Set up a quick vote on dinner"]) {
    assert.equal(route(text).capability, "prepare_poll", text);
  }
  assert.equal(route("Where should we eat?", { explicitAction: { kind: "ask_group", starterId: null } }).capability, "prepare_poll", "the explicit UI action always wins");
  assert.equal(route("Fix the wording", { draftSelected: true }).capability, "prepare_poll", "an editable draft is being edited through conversation");
});

test("Request a poll explicitly: legacy unthreaded contexts cannot create a draft from text alone", () => {
  const intent = routeCoordinatorIntent({ text: "Make a poll about dinner", draftSelected: false, snapshot: snapshot(), activeThreadId: null, flags, inputMode: "text" });
  assert.equal(intent.capability, "answer");
});

test("unsupported capability answered honestly: requests are refused, reports and questions are not", () => {
  const refused: Array<[string, string]> = [
    ["Book it", "booking"], ["Can you reserve the lodge for us?", "booking"], ["Book that", "booking"],
    ["Pay the deposit", "payment"], ["Pay for it", "payment"], ["Charge everyone their share", "payment"],
    ["Add this to my calendar", "calendar_write"], ["Put dinner on our Google calendar", "calendar_write"],
    ["Email the group the plan", "external_message"], ["Text everyone the address", "external_message"], ["Send the poll to the group", "external_message"], ["Send it", "external_message"], ["Send it to everyone", "external_message"],
    ["Merge the dinner and lodging threads", "thread_merge_or_split"], ["Split this thread into two", "thread_merge_or_split"],
    ["Move these messages to lodging", "move_messages"], ["Move the poll draft to the lodging thread", "move_messages"], ["Move everything to dinner", "move_messages"],
  ];
  for (const [text, reason] of refused) {
    const intent = route(text, {}, [thread("Saturday dinner"), thread("Lodging costs")]);
    assert.deepEqual(intent, { capability: "unsupported", reason }, text);
  }
  // A request that also carries something to plan is answered, with the limit stated first (by code), not refused.
  const withSubstance: Array<[string, string]> = [
    ["Book us a table for dinner around 5 near the condo", "booking"], ["We're driving from Denver; book us somewhere for dinner around 5", "booking"],
    ["Please make a reservation at Alpine Table", "booking"], ["Pay for the ski lessons and the rentals", "payment"],
    ["Put the Saturday dinner on my calendar at 5", "calendar_write"], ["Email everyone the dinner options for Saturday", "external_message"],
  ];
  for (const [text, reason] of withSubstance) {
    assert.deepEqual(route(text, {}, [thread("Saturday dinner"), thread("Lodging costs")]), { capability: "answer", limitNotice: reason }, text);
    assert.equal(isModelFreeRequest(text, undefined, true), false, `${text} needs the model`);
  }
  // "lock in" and "secure" usually mean decide, not reserve.
  for (const text of ["Let's lock in the dinner plan for Saturday", "Secure agreement on the dinner plan", "Let's lock in Friday for the ski day"]) {
    assert.equal(unsupportedReasonFor(text), null, text);
    assert.deepEqual(route(text), { capability: "answer" }, text);
  }
  for (const text of ["We booked the lodge last month", "Should we book a table early?", "Did anyone pay the deposit?", "Hold on, what about lunch?", "The calendar shows Friday as free", "Who emailed the group?", "What time is check-in?"]) {
    assert.equal(unsupportedReasonFor(text), null, text);
  }
  assert.equal(isModelFreeRequest("Book it", undefined, true), true, "a bare refusal never needs the model");
  assert.equal(isModelFreeRequest("Where should we eat?", undefined, true), false);
});

test("spoken approval never approves: a bare yes with a pending proposal is refused for voice and for text", () => {
  const pending = snapshot([thread("Lodging costs")]);
  const active = pending.threads[0].threadId;
  const withProposal = TripContextSnapshotSchema.parse({ ...pending, pendingProposals: [fact("proposal:x", { turnId: randomUUID(), threadId: active, kind: "trip_change", summary: "Proposed stay update, not applied", baseVersion: 1 }, "proposal")] });
  const base = { draftSelected: false, snapshot: withProposal, activeThreadId: active, flags } as const;
  for (const text of ["Yes", "Yes, apply it", "Go ahead and approve that", "Okay, publish it", "Sounds good, do it"]) {
    assert.deepEqual(routeCoordinatorIntent({ ...base, text, inputMode: "voice" }), { capability: "unsupported", reason: "voice_approval" }, text);
    assert.deepEqual(routeCoordinatorIntent({ ...base, text, inputMode: "text" }), { capability: "unsupported", reason: "approval_in_chat" }, text);
  }
  assert.equal(routeCoordinatorIntent({ ...base, text: "Yes", snapshot: pending, inputMode: "voice" }).capability, "answer", "with nothing pending, yes is just conversation");
  assert.equal(routeCoordinatorIntent({ ...base, text: "Yes, I'm attending the trip.", inputMode: "voice" }).capability, "record_attendance", "an attendance statement is not an approval");
});

test("a clear attendance statement routes to the direct exception from text and voice; ambiguity is left to the recorder", () => {
  for (const text of ["I am attending the trip.", "We're both attending", "Robin and I are attending", "Yes, I'm attending"]) {
    for (const inputMode of ["text", "voice"] as const) assert.equal(route(text, { inputMode }).capability, "record_attendance", `${inputMode}: ${text}`);
  }
  for (const text of ["I might be attending", "Is Robin attending?", "Robin is not attending", "We could go skiing if the weather holds"]) assert.notEqual(route(text).capability, "record_attendance", text);
});

test("navigation phrases: explicit targets, separate threads, and unsupported moves are parsed; ordinary text is not", () => {
  const cases: Array<[string, Record<string, unknown> | null]> = [
    ["Continue this in lodging", { action: "continue_in", target: "lodging", tentative: true }],
    ["Let's continue in the lodging thread", { action: "continue_in", target: "lodging", tentative: false }],
    ["open the restaurant thread", { action: "open", target: "restaurant", tentative: false }],
    ["Go to the Friday dinner conversation", { action: "open", target: "Friday dinner", tentative: false }],
    ["switch to lodging", { action: "open", target: "lodging", tentative: true }],
    ["Move this to lodging", { action: "continue_in", target: "lodging", tentative: true, moveWording: true }],
    ["Start a separate thread for the ski lessons", { action: "start_separate", target: "ski lessons" }],
    ["Start a separate thread for this", { action: "start_separate", target: null }],
    ["Open a new thread about lodging", { action: "start_separate", target: "lodging" }],
    ["Where should we open the thread?", null], ["What's in the lodging thread?", null], ["We should go to the restaurant at five", null], ["Start a new restaurant topic", null],
    // Ordinary plans that happen to contain "go to": never navigation, whatever threads exist.
    ["I want to go to the airport by 3", null], ["Let's go to dinner at 6", null], ["We should head to the lodge around 4", null], ["Take me to the airport", null], ["Let's go to the airport", null],
  ];
  for (const [text, expected] of cases) {
    const parsed = parseThreadNavigation(text);
    if (expected === null) assert.equal(parsed, null, text);
    else assert.deepEqual({ ...parsed }, { ...parsed, ...expected }, text);
    if (expected) assert.equal(parsed?.kind, "navigate", text);
  }
  assert.deepEqual(parseThreadNavigation("Merge the lodging and dinner threads"), { kind: "unsupported", reason: "thread_merge_or_split" });
  assert.deepEqual(parseThreadNavigation("Move all the messages to lodging"), { kind: "unsupported", reason: "move_messages" });
});

test("a spoken request keeps its sentence punctuation: navigation parses the same with or without the final period", () => {
  for (const text of ["Open the lodging thread.", "Open the lodging thread!", "Start a separate thread for the ski lessons.", "Go to the Friday dinner conversation.", "Continue this in lodging."]) {
    const plain = parseThreadNavigation(text.replace(/[.!]+$/, ""));
    assert.ok(plain && plain.kind === "navigate", text);
    assert.deepEqual(parseThreadNavigation(text), plain, text);
  }
  assert.equal(parseThreadNavigation("We should go to the restaurant at five."), null);
});

test("thread resolution picks a unique target and never chooses between equals", () => {
  const friday = thread("Friday dinner"), saturday = thread("Saturday dinner"), lodging = thread("Lodging costs"), skiing = thread("Ski lesson options", { summary: "Kids might do a morning lesson." });
  const archived = thread("Old lunch ideas", { status: "archived" });
  const all = [friday, saturday, lodging, skiing, archived];
  assert.deepEqual(resolveThreadReference("lodging", all), { kind: "unique", threadId: lodging.threadId });
  assert.deepEqual(resolveThreadReference("the stay", all), { kind: "unique", threadId: lodging.threadId }, "topic synonyms resolve");
  assert.deepEqual(resolveThreadReference("Friday dinner", all), { kind: "unique", threadId: friday.threadId });
  const dinner = resolveThreadReference("dinner", all);
  assert.equal(dinner.kind, "ambiguous");
  assert.deepEqual(dinner.kind === "ambiguous" && [...dinner.threadIds].sort(), [friday.threadId, saturday.threadId].sort());
  assert.equal(resolveThreadReference("restaurant", all).kind, "ambiguous", "restaurant matches both dinner threads");
  assert.deepEqual(resolveThreadReference("kids morning", all), { kind: "none" }, "a summary alone is too weak to pick a thread");
  assert.deepEqual(resolveThreadReference("weather", all), { kind: "none" });
  const lunch = resolveThreadReference("lunch", all);
  assert.equal(lunch.kind, "ambiguous", "a class match on the two dinner threads is not unique");
  assert.ok(lunch.kind === "ambiguous" && !lunch.threadIds.includes(archived.threadId), "archived threads are not candidates unless named exactly");
  assert.deepEqual(resolveThreadReference("Old lunch ideas", all), { kind: "unique", threadId: archived.threadId });
  assert.deepEqual(resolveThreadReference("dinner", all, { activeThreadId: friday.threadId, includeActive: false }), { kind: "unique", threadId: saturday.threadId }, "reading another thread excludes the active one");
});

test("Two possible dinner threads and explicit continue route to the right navigation intent", () => {
  const friday = thread("Friday dinner"), saturday = thread("Saturday dinner"), lodging = thread("Lodging costs");
  const threads = [lodging, friday, saturday];
  const ambiguous = route("Open the dinner thread", {}, threads);
  assert.equal(ambiguous.capability, "navigate_thread");
  assert.ok(ambiguous.capability === "navigate_thread" && ambiguous.targetThreadId === null && ambiguous.candidateThreadIds.length === 2);
  assert.deepEqual(route("Continue this in lodging", {}, [friday, saturday, lodging], 0), { capability: "navigate_thread", action: "continue_in", targetThreadId: lodging.threadId, candidateThreadIds: [], title: null });
  assert.deepEqual(route("Open the Friday dinner thread", {}, threads), { capability: "navigate_thread", action: "open", targetThreadId: friday.threadId, candidateThreadIds: [], title: null });
  const separate = route("Start a separate thread for ski lessons", {}, threads);
  assert.deepEqual(separate, { capability: "navigate_thread", action: "start_separate", targetThreadId: null, candidateThreadIds: [], title: "ski lessons" });
  assert.equal(route("take this to the airport", {}, threads).capability, "answer", "a tentative phrase with no matching thread is ordinary conversation");
  const missing = route("open the spa thread", {}, threads);
  assert.ok(missing.capability === "navigate_thread" && missing.targetThreadId === null && missing.candidateThreadIds.length === 0, "an explicit but unknown target is answered, not guessed");
});

test("references to another thread resolve only when unambiguous and never make the current thread change", () => {
  const friday = thread("Friday dinner"), saturday = thread("Saturday dinner"), lodging = thread("Lodging costs");
  assert.equal(parseThreadReference("use the dinner options we discussed"), "dinner options");
  assert.equal(parseThreadReference("Use the lodging options we discussed to pick a place near the lodge"), "lodging options");
  assert.equal(parseThreadReference("what did we decide about lodging?"), "lodging");
  assert.equal(parseThreadReference("from the lodging thread, what was the total?"), "lodging");
  assert.equal(parseThreadReference("Where should we eat?"), null);
  const unique = route("Use the lodging options we discussed", {}, [friday, saturday, lodging], 1);
  assert.deepEqual(unique, { capability: "retrieve_context", threadIds: [lodging.threadId], ambiguousThreadIds: [] });
  const ambiguous = route("Use the dinner options we discussed", {}, [lodging, friday, saturday], 0);
  assert.ok(ambiguous.capability === "retrieve_context" && ambiguous.threadIds.length === 0 && ambiguous.ambiguousThreadIds.length === 2);
  const same = route("use the dinner options we discussed", {}, [friday, lodging], 0);
  assert.equal(same.capability, "answer", "the active thread is not read as 'another' thread");
});

test("fact lookups over saved records use grounded retrieval; advice does not", () => {
  for (const text of ["What's our lodging address?", "When is check-in at the stay?", "How much is the lodging total?", "Who's attending?", "Show me the saved dates"]) assert.equal(isFactLookup(text), true, text);
  for (const text of ["Where should we stay next time?", "What lodging would you recommend?", "What are some good dinner ideas near the stay?", "Update the lodging cost to $2,000"]) {
    assert.equal(route(text).capability === "retrieve_context", false, text);
  }
});

test("link idea resolves a unique Plan idea by title and asks when the name is ambiguous or unknown", () => {
  assert.equal(parseLinkIdea("Link the ski lesson idea to this thread"), "ski lesson");
  assert.equal(parseLinkIdea("Attach ski rental to this conversation."), "ski rental");
  assert.equal(parseLinkIdea("How do I link an idea to this thread?"), null);
  assert.deepEqual(route("Link the ski lesson idea to this thread"), { capability: "link_idea", itineraryItemId: ids.idea, candidateItemIds: [] });
  const ambiguous = route("Link the ski idea to this thread");
  assert.ok(ambiguous.capability === "link_idea" && ambiguous.itineraryItemId === null && ambiguous.candidateItemIds.length === 2);
  const unknown = route("Link the spa day idea to this thread");
  assert.ok(unknown.capability === "link_idea" && unknown.itineraryItemId === null && unknown.candidateItemIds.length === 0);
  assert.deepEqual(resolveIdea("ski", [{ itemId: "a", title: "Ski Lesson" }, { itemId: "b", title: "Ski Rental" }]), { kind: "ambiguous", itemIds: ["a", "b"] });
});

test("research requests: explicit phrasing only, gated on configuration, with a sanitized public query", () => {
  for (const text of ["Look up kid-friendly dinner spots", "Research family lodging options", "Search online for ski lessons", "Find me some restaurants near the lodge"]) assert.equal(isExplicitResearchRequest(text), true, text);
  for (const text of ["We looked up restaurants yesterday", "What did the research say?", "Where should we eat?", "Make a poll to research options"]) assert.equal(isExplicitResearchRequest(text), false, text);
  const intent = route("Look up kid-friendly dinner spots near Synthetic Peak Lodge for Robin's family");
  assert.ok(intent.capability === "research" && intent.querySource === "sanitized_from_request");
  assert.equal(route("Look up kid-friendly dinner spots", {}, [], 0).capability, "research");
  assert.equal(routeCoordinatorIntent({ text: "Look up kid-friendly dinner spots", draftSelected: false, snapshot: snapshot([thread("Dinner")]), activeThreadId: null, flags: { ...flags, researchConfigured: false }, inputMode: "text" }).capability, "answer", "no search key: ordinary conversation, not a fake search");
  assert.deepEqual(route("Look up Casey Synthetic and Robin Synthetic"), { capability: "unsupported", reason: "research_query_unsafe" });
});

test("research queries never contain roster names, addresses, codes, contact details, amounts, or dates", () => {
  const context = snapshot([thread("Dinner")]);
  const secret = "Look up kid-friendly dinner spots near Synthetic Peak Lodge at 100 Synthetic Ridge Rd for Robin's family, budget $200 total, confirmation ABC123XYZ, call +1 (970) 555-0142 or casey.private@example.com, arriving 2027-02-12. Taylor is allergic to peanuts.";
  const query = buildPublicResearchQuery(secret, context)!;
  assert.match(query, /kid-friendly dinner spots/);
  assert.match(query, /Breckenridge/, "the public destination is added");
  assert.ok(query.length <= 120);
  for (const leaked of ["Synthetic", "Robin", "Casey", "Taylor", "100", "Ridge Rd", "$", "200", "ABC123", "555", "@", "2027", "peanut", "family", "confirmation", "lodge"]) assert.equal(query.toLowerCase().includes(leaked.toLowerCase()), false, `${leaked} in "${query}"`);
  assert.equal(query, "kid-friendly dinner spots in Breckenridge, Colorado");
  assert.equal(buildPublicResearchQuery("Research it", context), null, "nothing substantive left");
  assert.equal(buildPublicResearchQuery("Look up Robin Synthetic, Casey Synthetic and Taylor Synthetic", context), null);
  const typed = sanitizeTypedResearchQuery("Restaurants for Casey Synthetic near 100 Synthetic Ridge Rd, ref ABC123XYZ, budget $150", context)!;
  assert.equal(typed.changed, true);
  for (const leaked of ["Casey", "Synthetic", "100 ", "ABC123", "$150"]) assert.equal(typed.query.includes(leaked), false, `${leaked} in "${typed.query}"`);
  assert.match(typed.query, /Restaurants/);
  assert.deepEqual(sanitizeTypedResearchQuery("family-friendly restaurants in Breckenridge", context), { query: "family-friendly restaurants in Breckenridge", changed: false });
});

test("derived ids are stable per command and label and never collide across labels", () => {
  const commandId = randomUUID();
  assert.equal(derivedUuid(commandId, "thread"), derivedUuid(commandId, "thread"));
  assert.notEqual(derivedUuid(commandId, "thread"), derivedUuid(commandId, "draft"));
  assert.notEqual(derivedUuid(commandId, "thread"), derivedUuid(randomUUID(), "thread"));
  assert.match(derivedUuid(commandId, "thread"), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("R11 derived ids are scoped to the trip and organizer: the same command id in another trip or by another organizer derives different ids", () => {
  const commandId = randomUUID(), trip = randomUUID(), other = randomUUID(), casey = randomUUID(), robin = randomUUID();
  const seed = derivedIdSeed(trip, casey, commandId);
  assert.equal(derivedUuid(seed, "thread"), derivedUuid(derivedIdSeed(trip, casey, commandId), "thread"), "stable for retries");
  for (const label of ["thread", "draft", "thread-command"]) {
    assert.notEqual(derivedUuid(seed, label), derivedUuid(derivedIdSeed(other, casey, commandId), label), `${label}: another trip`);
    assert.notEqual(derivedUuid(seed, label), derivedUuid(derivedIdSeed(trip, robin, commandId), label), `${label}: another organizer`);
    assert.notEqual(derivedUuid(seed, label), derivedUuid(commandId, label), `${label}: the bare command id`);
  }
});

test("spoken summaries stay short and listenable", () => {
  const long = Array.from({ length: 10 }, (_, index) => `Sentence number ${index} is here.`).join(" ");
  assert.ok(spokenSummary(long).length <= 600);
  assert.equal(spokenSummary(long).split(/(?<=\.)\s/).length, 3);
});

test("spoken summaries never split inside an amount or a decimal number (a spoken answer used to become \"00.\")", () => {
  assert.equal(spokenSummary("The lodge total is $1,840.00."), "The lodge total is $1,840.00.");
  assert.equal(spokenSummary("The lodge total is $1,840.00. Nothing else changed. Robin rated it 4.5 stars. Fourth sentence is dropped."), "The lodge total is $1,840.00. Nothing else changed. Robin rated it 4.5 stars.");
  assert.equal(spokenSummary("Dinner at 5:30 p.m. works. Book nothing yet"), "Dinner at 5:30 p.m. works. Book nothing yet");
  assert.equal(spokenSummary(""), "");
});

// ---------------------------------------------------------------------------
// Stage 8: consequential capabilities are conservative. Hedged, reported, future, third-person, questioning or ambiguous phrasing falls through to an
// ordinary answer (the model may then OFFER the action); explicit UI actions stay authoritative.
// ---------------------------------------------------------------------------

test("R1 poll drafts need an explicit imperative request: questions, reports, plans and hedges answer instead (and may offer)", () => {
  const notRequests = ["Should we ask the group about dinner?", "Robin said she'd ask the group.", "I'll ask everyone myself later", "Maybe ask the group about dinner", "I want to ask the group where to eat",
    "Do you think we should poll the group?", "Robin wants to make a poll", "We could set up a vote later", "Would it help to ask the group?", "Robin will ask the group and then make a poll", "Ask the group later",
    "If needed, ask the group", "Don't ask the group yet", "Should I make a poll about dinner?", "\"Ask the group where to eat\" is what Robin told me", "Robin, ask the group about dinner"];
  for (const text of notRequests) {
    for (const inputMode of ["text", "voice"] as const) {
      const intent = route(text, { inputMode });
      assert.notEqual(intent.capability, "prepare_poll", `${inputMode}: ${text}`);
      assert.equal(isExplicitPollRequest(text, inputMode), false, `${inputMode}: ${text}`);
    }
  }
  // The model is told to offer (nothing was created) when the wording was about asking the group.
  assert.deepEqual(route("Should we ask the group about dinner?", { inputMode: "voice" }), { capability: "answer", offer: "poll" });
  assert.deepEqual(route("Robin said she'd ask the group.", {}), { capability: "answer", offer: "poll" });
  assert.deepEqual(route("Where should we eat?"), { capability: "answer" }, "no mention of the group: nothing to offer");
  const explicit = ["Make a poll asking where to eat", "Please prepare a poll for the group about dinner", "Can you poll the group on Saturday plans?", "Ask the group where they want to eat", "Ok, ask everyone which night works", "Thanks, make a poll about lodging",
    "Where should we eat? Ask the group.", "Let's get the group's input on lodging", "Set up a quick vote on dinner", "Let the group vote on the two lodges"];
  for (const text of explicit) assert.equal(route(text).capability, "prepare_poll", text);
  // Spoken requests are held to the strongest phrasing: a poll/survey/vote is named. A spoken "ask the group..." is answered with an offer.
  for (const text of ["Make a poll asking where to eat", "Please set up a survey about dinner", "Poll the group about Saturday"]) assert.equal(route(text, { inputMode: "voice" }).capability, "prepare_poll", `voice: ${text}`);
  for (const text of ["Ask the group where they want to eat", "Get the group's input on lodging"]) assert.deepEqual(route(text, { inputMode: "voice" }), { capability: "answer", offer: "poll" }, `voice: ${text}`);
  assert.equal(route("Should we ask the group?", { explicitAction: { kind: "ask_group", starterId: null } }).capability, "prepare_poll", "the explicit UI action stays authoritative");
});

test("R1 a draft attached as context never steers routing by itself; a selected draft is edited only by edit-like requests", () => {
  // The client attaches the thread's unpublished goal draft to every turn: research, lookups, questions and references must route normally.
  const attached = { draftSelected: false, draftAttached: true };
  assert.equal(route("Look up kid-friendly dinner spots", attached).capability, "research");
  assert.equal(route("What's our lodging address?", attached).capability, "retrieve_context");
  assert.equal(route("Use the lodging options we discussed", attached, [thread("Saturday dinner"), thread("Lodging costs")]).capability, "retrieve_context");
  assert.equal(route("Where should the family eat?", attached).capability, "answer");
  assert.equal(route("Make it friendlier", attached).capability, "answer", "an edit-like message that names nothing in the draft is not enough");
  assert.equal(route("Add more options for dinner", { ...attached, draftAttached: false }).capability, "answer", "no draft, nothing to edit");
  // Only a message that plainly edits a named part of the attached draft edits it.
  for (const text of ["Make the intro shorter", "Add a question about dietary needs", "Please reword the second option", "Change the title to Friday dinner", "Remove the last option"]) {
    assert.equal(route(text, attached).capability, "prepare_poll", text);
  }
  // Even a draft the organizer explicitly selected is edited only by edit-like messages.
  const selected = { draftSelected: true, draftAttached: true };
  for (const text of ["Fix the wording", "Make the intro shorter", "Can you change the title to Friday dinner?", "Add a question about dietary needs", "The title should say Friday dinner", "Please reword the second option", "Remove the last option", "Make it friendlier"]) assert.equal(route(text, selected).capability, "prepare_poll", text);
  assert.equal(route("Look up kid-friendly dinner spots", selected).capability, "research", "research is not an edit");
  assert.equal(route("What's our lodging address?", selected).capability, "retrieve_context", "lookups are not edits");
  assert.equal(route("Use the lodging options we discussed", selected, [thread("Saturday dinner"), thread("Lodging costs")]).capability, "retrieve_context", "a reference to another thread is not a draft edit");
  for (const text of ["What did we say about the lodge?", "How many people are attending?", "Where should we eat Saturday?", "Should the title say Friday dinner?", "Is the intro too long?"]) assert.notEqual(route(text, selected).capability, "prepare_poll", text);
});

test("R2 internal lookups are answered from Commons: thread references and first-person-plural recall never reach the public web", () => {
  const threads = [thread("Saturday dinner"), thread("Lodging costs")];
  const recall = route("Look up what we discussed in the lodging thread", {}, threads);
  assert.deepEqual(recall, { capability: "retrieve_context", threadIds: [threads[1].threadId], ambiguousThreadIds: [] });
  for (const text of ["Look up what we decided about dinner", "Search for what we discussed", "Look up our notes", "Look up our plan for Saturday", "Look up the lodging thread", "Research what we said about the budget", "Look up my notes on the stay"]) {
    assert.equal(route(text, {}, threads).capability, "retrieve_context", text);
  }
  assert.equal(route("Look up what we discussed in the airport thread", {}, threads).capability, "retrieve_context", "an unknown thread is still an internal question, not a web search");
  // A roster traveler's own itinerary lives in Commons.
  assert.equal(route("Look up Taylor's flight UA 1234 arrival time", {}, threads).capability, "retrieve_context");
  // Genuine public lookups still search.
  for (const text of ["Look up kid-friendly dinner spots", "Look up restaurants near the lodge", "Research family lodging options in Breckenridge"]) assert.equal(route(text, {}, threads).capability, "research", text);
});

test("R2 phone numbers, emails and addresses of people are never searched; names, flight numbers and booking codes are redacted", () => {
  const context = snapshot([thread("Dinner")]);
  for (const text of ["look up our Airbnb host Jamie Rivera's phone number", "Look up Jamie Rivera's email", "Search for the phone number of our host", "Look up Robin's home address", "Google Jamie Rivera phone number"]) {
    assert.deepEqual(route(text), { capability: "unsupported", reason: "research_contact_lookup" }, text);
  }
  // A business can still be looked up by name.
  assert.equal(route("Look up the phone number for Alpine Table restaurant").capability, "research");
  // Person names near roles and possessives (not on the roster) never survive into a query.
  assert.equal(buildPublicResearchQuery("Look up dinner spots near Jamie Rivera's place", context), "dinner spots in Breckenridge, Colorado");
  assert.equal(buildPublicResearchQuery("Look up dinner spots for our host Jamie Rivera and her kids", context), "dinner spots in Breckenridge, Colorado");
  assert.equal(buildPublicResearchQuery("Look up our Airbnb host Jamie Rivera", context), null, "nothing but the person was asked about: do not search");
  // Flight numbers, booking references and ticket numbers are cut; a request that was only about them is not searched.
  assert.equal(buildPublicResearchQuery("Look up Taylor's flight UA 1234 arrival time", context), null);
  for (const text of ["Look up flight UA 1234 status", "Look up UA1234", "Look up ticket number 0167890123456 for us"]) assert.equal(buildPublicResearchQuery(text, context), null, text);
  const cleaned = buildPublicResearchQuery("Look up good breakfast spots, our flight AA 100 lands at noon, record locator XK4T9Q", context)!;
  for (const leaked of ["AA", "100", "XK4T9Q", "locator"]) assert.equal(cleaned.includes(leaked), false, `${leaked} in "${cleaned}"`);
  assert.match(cleaned, /breakfast spots/);
  const typed = sanitizeTypedResearchQuery("Restaurants near the airport for flight UA 1234, PNR ABC123", context)!;
  assert.equal(/UA 1234|ABC123/.test(typed.query), false, typed.query);
});

test("R3 navigation needs an explicit thread word or verb form AND a matching thread; ordinary plans that say go to never navigate", () => {
  const airport = thread("Airport pickup"), dinner = thread("Friday dinner"), lodging = thread("Lodging costs");
  const threads = [lodging, airport, dinner];
  for (const text of ["I want to go to the airport by 3", "Let's go to dinner at 6", "We should head to dinner around six", "Take me to the airport", "Let's go to the airport", "Go to dinner at 6", "Switch to dinner at 6", "Continue with dinner at 6", "Open the pizza place"]) {
    const intent = route(text, {}, threads);
    assert.equal(intent.capability === "navigate_thread", false, text);
    assert.equal(isModelFreeRequest(text, undefined, true), false, `${text} is never model-free navigation`);
  }
  // Explicit thread word, explicit verb form with an existing thread.
  const wanted: Array<[string, string]> = [["Go to the airport thread", airport.threadId], ["Open the Friday dinner thread", dinner.threadId], ["Switch to lodging", lodging.threadId], ["Open lodging costs", lodging.threadId],
    ["Continue this in lodging", lodging.threadId], ["Let's move to the airport pickup conversation", airport.threadId], ["move this to lodging", lodging.threadId]];
  for (const [text, threadId] of wanted) {
    const intent = route(text, {}, threads, 2);
    assert.ok(intent.capability === "navigate_thread" && intent.targetThreadId === threadId, `${text}: ${JSON.stringify(intent)}`);
  }
  // An explicit verb form with no matching thread is ordinary conversation; only a thread word earns "I couldn't find that thread".
  assert.equal(route("Continue this in the spa", {}, threads).capability, "answer");
  assert.equal(route("Switch to the spa", {}, threads).capability, "answer");
  const missing = route("Open the spa thread", {}, threads);
  assert.ok(missing.capability === "navigate_thread" && missing.targetThreadId === null && missing.candidateThreadIds.length === 0);
  assert.equal(route("Go to dinner at 6", {}, threads).capability, "answer");
});

// Plan-item updates: a reported confirmation, cancellation or time change of a saved plan is a plan update to review; everything hedged, questioning or unrelated stays an answer.
const flyPlan = randomUUID();
const withPlans = () => snapshot([thread("Saturday dinner")], { plans: [
  fact(`plan:${flyPlan}`, { itemId: flyPlan, title: "Fly-fishing lesson", status: "planned" as const, startsAt: "2027-10-12T15:00:00.000Z", location: null, participantScope: "everyone" as const }, "itinerary_item"),
  fact(`plan:${randomUUID()}`, { itemId: randomUUID(), title: "Sunset sleigh ride", status: "planned" as const, startsAt: null, location: null, participantScope: "everyone" as const }, "itinerary_item")] as TripContextSnapshot["plans"] });
const routePlan = (text: string, over: Partial<RouteInput> = {}) => { const shot = withPlans(); return routeCoordinatorIntent({ text, draftSelected: false, snapshot: shot, activeThreadId: shot.threads[0].threadId, flags, inputMode: "text", ...over }).capability; };

test("Plan reports route to a trip change, by text and voice; questions, hedges and unrelated statements are answers", () => {
  for (const text of ["We've confirmed fly fishing for 9 AM on 10/12. The guide (James)'s phone is 505-412-7380", "Fly fishing is booked for 9 on 10/12", "we cancelled the sleigh ride", "fly fishing moved to 10 AM", "Mark fly fishing as confirmed"]) {
    assert.equal(routePlan(text), "propose_trip_change", text);
    assert.equal(routePlan(text, { inputMode: "voice" }), "propose_trip_change", `voice: ${text}`);
  }
  for (const text of ["Should we confirm fly fishing?", "Have we confirmed fly fishing", "We'll confirm fly fishing tomorrow", "maybe we should cancel the sleigh ride", "What time is fly fishing?", "We confirmed this with Robin", "The guide (James)'s phone is 505-412-7380"]) {
    assert.equal(routePlan(text), "answer", text);
  }
  assert.equal(routePlan("We've confirmed fly fishing", { flags: { ...flags, tripChangesEnabled: false } }), "answer", "with trip changes switched off the message is an ordinary answer");
  assert.equal(routePlan("Make the intro say fly fishing is confirmed", { draftSelected: true }), "prepare_poll", "with a draft selected, wording about a plan is a draft edit");
  const shot = withPlans(), booking = routeCoordinatorIntent({ text: "Book fly fishing for 9 AM", draftSelected: false, snapshot: shot, activeThreadId: shot.threads[0].threadId, flags, inputMode: "text" });
  assert.deepEqual(booking, { capability: "answer", limitNotice: "booking" }, "booking is still refused, in code, and never becomes a plan update");
});

// Production transcript, "Fly-fishing confirmation": follow-ups that name no plan resolve from the thread, or are answered honestly.
const planThread = (messages: string[], threadTitle: string | null = "Fly-fishing confirmation") => ({ messages: messages.map(text => ({ text })), threadTitle });
const flyReport = "We've confirmed fly fishing for 9 AM on 10/12. The guide (James)'s phone is 505-412-7380";
const routeFollowUp = (text: string, over: Partial<RouteInput> = {}) => { const shot = withPlans(); return routeCoordinatorIntent({ text, draftSelected: false, snapshot: shot, activeThreadId: shot.threads[0].threadId, flags, inputMode: "text", planThread: planThread([flyReport]), ...over }); };

test("Fly-fishing transcript: follow-ups resolved from the thread route to a trip change, by text and voice; hedges and questions are answers", () => {
  for (const text of ["I want to change the activity status to confirmed", "mark it confirmed", "Confirm it", "yes, update the status", "Go ahead and mark that confirmed", "Where is the card?", "make the card"]) {
    assert.equal(routeFollowUp(text).capability, "propose_trip_change", text);
    assert.equal(routeFollowUp(text, { inputMode: "voice" }).capability, "propose_trip_change", `voice: ${text}`);
  }
  for (const text of ["Should we confirm it?", "maybe we should mark it confirmed", "Did we confirm it?", "Is it confirmed?", "I'll mark it confirmed tomorrow", "What is the status of fly fishing?"]) assert.equal(routeFollowUp(text).capability, "answer", text);
  // No referent in this thread: a bare follow-up is not guessed; one that says "the activity" gets the honest not-found text from the trip-change path.
  assert.equal(routeFollowUp("mark it confirmed", { planThread: planThread(["what should we eat?"], "Saturday dinner") }).capability, "answer");
  assert.equal(routeFollowUp("Where is the card?", { planThread: planThread(["what should we eat?"], "Saturday dinner") }).capability, "answer");
  assert.equal(routeFollowUp("change the activity status to confirmed", { planThread: planThread(["what should we eat?"], "Saturday dinner") }).capability, "propose_trip_change");
  // The title alone can name the plan.
  assert.equal(routeFollowUp("mark it confirmed", { planThread: planThread(["yes please"]) }).capability, "propose_trip_change");
  // With a draft selected, plan wording is draft wording; the follow-up route is off.
  assert.equal(routeFollowUp("mark it confirmed", { draftSelected: true }).capability, "answer");
  // Without thread context nothing changes for existing behavior.
  assert.equal(routeFollowUp("mark it confirmed", { planThread: undefined }).capability, "answer");
});

test("Fly-fishing transcript: with trip changes off, a resolvable plan follow-up is a model-free 'turned off right now' answer, and everything else is unchanged", () => {
  const off = { flags: { ...flags, tripChangesEnabled: false } };
  const confirmed = routeFollowUp("I want to change the activity status to confirmed", off);
  assert.deepEqual(confirmed, { capability: "unsupported", reason: "plan_updates_off", planStatus: "confirmed" });
  assert.equal(RoutedIntentSchema.safeParse(confirmed).success, true);
  assert.deepEqual(routeFollowUp("Where is the card?", off), { capability: "unsupported", reason: "plan_updates_off", planStatus: "confirmed" }, "the status comes from the report the plan was named in");
  assert.deepEqual(routeFollowUp("cancel it", { ...off, planThread: planThread(["we cancelled fly fishing"]) }), { capability: "unsupported", reason: "plan_updates_off", planStatus: "cancelled" });
  assert.equal(routeFollowUp("Should we confirm it?", off).capability, "answer");
  assert.equal(routeFollowUp("We've confirmed fly fishing", off).capability, "answer", "a report is still an ordinary answer");
  assert.equal(routeFollowUp("mark it confirmed", { ...off, planThread: planThread(["what should we eat?"], "Saturday dinner") }).capability, "answer");
  assert.equal(isModelFreeRequest("mark it confirmed", undefined, true), false, "the model-free flag is unchanged; the reply itself is written without a model call");
});


test("Relative plan requests and unresolved acceptance route to review; pending acceptance never applies", () => {
  const saved = snapshot([], TripContextSnapshotSchema.parse({ ...snapshot(), plans: [fact(`plan:${ids.idea}`, { itemId: ids.idea, title: "Fly-fishing lesson", status: "confirmed", startsAt: "2026-10-12T15:00:00Z", location: null, participantScope: "everyone" }, "itinerary_item")] }));
  const text = "I'd like to move fly fishing up by a day";
  const input = { snapshot: saved, activeThreadId: null, draftSelected: false, inputMode: "text" as const, flags, planThread: { messages: [{ text }], threadTitle: null }, previousUserText: text };
  assert.equal(routeCoordinatorIntent({ ...input, text }).capability, "propose_trip_change");
  assert.equal(routeCoordinatorIntent({ ...input, text: "Yes" }).capability, "propose_trip_change");
  assert.equal(routeCoordinatorIntent({ ...input, text: "No" }).capability, "answer");
});

test("activity title commands bypass inference and draft editing, while explicit UI actions keep priority", () => {
 const text="Add as ideas: Seal Sanctuary, MOXI, Sea Center";
 assert.equal(isModelFreeRequest(text,undefined,true),true);
 assert.equal(route(text).capability,"add_activities");
 assert.equal(route(text,{draftSelected:true,inputMode:"voice"}).capability,"add_activities");
 assert.equal(route(text,{explicitAction:{kind:"ask_group",starterId:"dates"}}).capability,"prepare_poll");
});

 test("quick provider request routes to bounded lookup even when lookup configuration is absent",()=>{
 const exact="I need a car service for getting to Sonoma after we land on Thursday. Find one for me?";
 for(const researchConfigured of [true,false]) {const intent=route(exact,{flags:{...flags,researchConfigured}});assert.equal(intent.capability,"research");if(intent.capability==="research"){assert.match(intent.query,/airport car service published rates/);assert.doesNotMatch(intent.query,/Thursday|we land|Casey|Synthetic|Ridge|1:12/);}}
 for(const text of ["Should we find a car service?","Maybe recommend a hotel","Don't find a car service","Book a car service","What is my saved flight?"])assert.notEqual(route(text).capability,"research",text);
 });


test("quick lookup never appends private text from a freeform saved destination", () => {
  for (const destination of ["Sonoma, qa@example.test", "Sonoma, 1325 Broadway", "Sonoma booking ABCDEF", "Sonoma 2026-11-05", "Sonoma with Casey Synthetic", "Sonoma, +1 555 123 4567"]) {
    const context = snapshot();
    context.trip.value.destination = destination;
    assert.equal(buildPublicResearchQuery("airport car service published rates", context), "airport car service published rates");
    assert.equal(quickRecommendationQuery("I need a car service for getting to Sonoma after we land on Thursday. Find one for me?", context), "airport car service published rates");
  }
  const context = snapshot(); context.trip.value.destination = "Sonoma, California";
  assert.equal(buildPublicResearchQuery("airport car service published rates", context), "airport car service published rates in Sonoma, California");
});

test("private scope constraints do not negate an explicit poll action; cancelled/hedged creation still cannot create", () => {
  for (const text of ["Create a new private restaurant poll about dinner. Do not publish, send invitations, create tasks or change the itinerary.","Please make a private dinner poll. Keep it in this conversation.","Draft a new group survey. Don't send it."]) assert.equal(isExplicitPollRequest(text),true,text);
  for (const text of ["Don't create a poll.","Create a poll later. Don't send it.","Maybe create a private poll.","Create a poll. Do not create it after all.","I will create a private poll.","Should we create a poll?","Create a new private restaurant poll if needed."]) assert.equal(isExplicitPollRequest(text),false,text);
});


test("private poll naming is generic and bounded, and cancellation follows the poll object", () => {
  for (const text of [
    "Create a new private restaurant poll: Billy’s Tavern or Becky’s House of Horrors. Do not create tasks.",
    "Create a new lodging poll with Hotel A and Hotel B.",
    "Please create a private dates poll with November 5 and November 12. Do not create itinerary items.",
    "Build a new trip attendance poll with Attending and Not attending. Do not send invitations.",
    "Make a new airport-transfer poll with Shared van and Separate cars. Don't draft plans.",
    "Create a poll. No need to create tasks. Cancel the transport task.",
    "Create a new hotel poll. Do not make the existing poll shorter."
  ]) assert.equal(isExplicitPollRequest(text), true, text);
  for (const text of [
    "Create a new lodging poll. Do not create the poll.",
    "Create a new lodging poll. Don't create it after all.",
    "Create a new lodging poll. Stop creating that lodging poll.",
    "Create a new lodging poll. Cancel the new lodging poll.",
    "Do not create a new dates poll.",
    "Maybe create a lodging poll.",
    "Should we create an attendance poll?",
    "Robin said: Create a new lodging poll.",
    "“Create a new lodging poll” was Robin’s suggestion.",
    "> Create a new lodging poll with Hotel A and Hotel B.",
    "Make the lodging poll shorter.",
    "Make the existing lodging poll private.",
    "Make the lodging poll introduction shorter.",
    "Make this poll’s introduction shorter.",
    "Create a task about a lodging poll.",
    "Create a new plan from the lodging poll.",
    "Create a task and a poll.",
    "Create a new lodging poll later.",
    "Create a new private regional weekend lodging preferences poll.",
    `Create a ${"a".repeat(33)} poll.`
  ]) assert.equal(isExplicitPollRequest(text), false, text);
});


test("a direct construction request may contain a whether question without becoming hedged intent", () => {
  assert.equal(isExplicitPollRequest("Create a new dates poll asking whether November 5 or November 12 works. Keep it private.","text"),true);
  assert.equal(isExplicitPollRequest("Maybe create a new dates poll asking whether November 5 works.","text"),false);
  assert.equal(isExplicitPollRequest("Should we create a dates poll asking whether November 5 works?","text"),false);
});


test("explicit public lodging price ceiling survives; private costs and identifiers remain redacted",()=>{
 const context=snapshot([thread("Dinner")]);
 for(const query of ["Find me a hotel in Texas under $200","Find me a hotel in texas under 200$"])assert.equal(sanitizePublicLodgingQuery(query,context)?.query,query);
 for(const query of ["Hotel under $200 near Synthetic Peak Lodge","Hotel under $200 for Robin Synthetic","Hotel under $200 confirmation ABC123XYZ","Hotel under $200 email casey.private@example.com","Hotel under $200 on 2027-02-12","Hotel under $200; our saved cost $620"]){const result=sanitizePublicLodgingQuery(query,context)?.query??"";assert.doesNotMatch(result,/200|620|ABC123|@|2027|Robin|Synthetic/);}
 assert.doesNotMatch(sanitizeTypedResearchQuery("Hotel under $200",context)!.query,/200/);
});

test("venue hours and an immediate check-that follow-up route to the same bounded public lookup", async () => {
  const { venueHoursQuestion, venueHoursSource } = await import("./coordinator-venue-hours");
  const question = "When does the Randall Davey Audubon center close?";
  const original = route(question);
  assert.equal(original.capability, "research");
  assert.deepEqual(route("I want you to check that", { previousUserText: question }), original);
  assert.equal(route("I want you to check that", { previousUserText: "Summarize the trip" }).capability, "answer");
  assert.equal(venueHoursQuestion('Casey said "When does the museum close?"'), null);
  assert.equal(route("When does our flight close?").capability, "retrieve_context");
  assert.equal(route(question, { flags: { tripChangesEnabled: true, researchConfigured: false } }).capability, "research");
  const context = snapshot();
  context.plans[0].value = { ...context.plans[0].value, title: "Randall Davey Audubon Center", sourceUrl: "https://audubon.example.org/visit" };
  assert.deepEqual(venueHoursSource(question, context), { url: "https://audubon.example.org/visit", title: "Randall Davey Audubon Center" });
  context.plans[0].value.sourceUrl = "https://audubon.example.org/visit?bookingId=PRIVATE";
  assert.equal(venueHoursSource(question, context), null);
  context.plans[0].value.sourceUrl = "https://127.0.0.1/visit";
  assert.equal(venueHoursSource(question, context), null);
  context.plans[0].value.sourceUrl = "https://audubon.example.org/visit";
  context.plans.push({ ...context.plans[0] });
  assert.equal(venueHoursSource(question, context), null, "Duplicate matches cannot choose another activity's website");
});
