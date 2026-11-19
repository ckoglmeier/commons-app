import test from "node:test";
import assert from "node:assert/strict";
import { ResearchDecisionBriefSchema, DecisionExtractionSchema } from "@commons/contracts";
import { decisionFixture, decisionSources, sonomaWineryBrief, sonomaTransportBrief, wineryFixtureExtraction, transportFixtureExtraction, retrospectiveDecisionBrief } from "./research-decision-fixture";
import { compareResearchDecision, normalizeDecisionExtraction, referenceAmountCents, refineResearchComparison } from "./research-decision";
const clone = <T>(x: T): T => structuredClone(x);
const wineries = (extraction: unknown = wineryFixtureExtraction(), brief = sonomaWineryBrief()) => compareResearchDecision({ brief, sources: decisionSources(), extraction, comparisonId: decisionFixture.artifact, mode: "fixture" });
const transport = (extraction: unknown = transportFixtureExtraction(), brief = sonomaTransportBrief()) => compareResearchDecision({ brief, sources: decisionSources(), extraction, comparisonId: decisionFixture.artifact });

test("winery case keeps nine nominations, priority and member access instead of inventing a new shortlist", () => {
  const c = wineries(); assert.equal(c.candidates.length, 9); assert.equal(c.candidates[0].id, "schramsberg");
  assert.equal(c.candidates[0].fit, "unsuitable"); assert.match(c.candidates[0].reasons.join(" "), /8 is below 9/);
  assert.equal(c.candidates.find(x => x.id === "hanzell")!.fit, "conditional");
  assert.equal(c.candidates.find(x => x.id === "peay")!.fit, "conditional");
  assert.equal(c.approval, "not_requested"); assert.equal(c.booking, "not_booked");
});
test("winery group arithmetic remains a partial reference, never a booking or all-in offer", () => {
  const c = wineries().candidates.find(x => x.id === "flowers")!;
  assert.equal(c.price.subtotalCents, 117000); assert.equal(c.price.completeness, "partial_reference");
});
test("currency is not inferred from a dollar sign", () => {
  const e = wineryFixtureExtraction(); e.findings = e.findings.filter(f => f.field !== "currency");
  assert.equal(wineries(e).candidates.find(x => x.id === "flowers")!.price.subtotalCents, null);
});
test("conflicting capacity findings cannot make an oversized group fit", () => {
  const e = wineryFixtureExtraction(); e.findings.push({ ...e.findings[0], value: 6 });
  const c = wineries(e).candidates.find(x => x.id === "flowers")!;
  assert.equal(c.fit, "conditional"); assert.match(c.reasons.join(" "), /Conflicting/);
});
test("member-only nominee without a connection is unsuitable", () => {
  const b = sonomaWineryBrief(); b.nominated.find(n => n.id === "hanzell")!.memberConnection = false;
  assert.equal(wineries(wineryFixtureExtraction(), b).candidates.find(x => x.id === "hanzell")!.fit, "unsuitable");
});
test("published weekdays mismatch is a real constraint", () => {
  const b = sonomaWineryBrief(); b.requestedWeekdays = ["Sunday"];
  assert.equal(wineries(wineryFixtureExtraction(), b).candidates.find(x => x.id === "flowers")!.fit, "unsuitable");
});
test("unknown candidates, ungrounded quotes and mistyped capacity are discarded", () => {
  for (const patch of [{ candidateId: "invented" }, { quote: "not in the captured text" }, { value: "plenty" }]) {
    const e = wineryFixtureExtraction(); e.findings = [{ ...e.findings[0], ...patch }];
    const n = normalizeDecisionExtraction(sonomaWineryBrief(), decisionSources(), e);
    assert.equal(n.extraction.findings.length, 0); assert.ok(n.limitations.length);
  }
});
test("a source ref is scoped by run, not just repeated source-1", () => {
  const e = wineryFixtureExtraction(); e.findings[0].source.runId = decisionFixture.task;
  assert.equal(normalizeDecisionExtraction(sonomaWineryBrief(), decisionSources(), e).extraction.findings.length, e.findings.length - 1);
});
test("untrusted extraction cannot insert instructions or booking authority", () => {
  assert.equal(normalizeDecisionExtraction(sonomaWineryBrief(), decisionSources(), { ...wineryFixtureExtraction(), bookNow: true }).extraction.findings.length, 0);
});
test("whole-trip transport compares four strategies covering all three required legs", () => {
  const c = transport(); assert.equal(c.candidates.length, 4);
  for (const candidate of c.candidates) { assert.equal(candidate.coverage.length, 3); assert.equal(candidate.fit, "conditional"); assert.equal(candidate.price.kind, "fixture"); }
  assert.equal(c.candidates.find(x => x.id === "transfers-driver")!.price.subtotalCents, 120000);
  assert.equal(c.candidates.find(x => x.id === "rental-driver")!.price.subtotalCents, 117000);
});
test("unknown luggage and sober-driver willingness are questions, not assumptions", () => {
  const c = transport(); assert.match(c.question!, /sober driver/);
  assert.match(c.candidates[0].reasons.join(" "), /luggage capacity needs checking/);
  assert.match(c.candidates[0].reasons.join(" "), /confirm willing sober drivers/);
});
test("insufficient seats or luggage makes a package unsuitable", () => {
  for (const luggage of [false, true]) {
    const e = transportFixtureExtraction(), b = sonomaTransportBrief(); b.luggagePieces = 9;
    if (luggage) e.components[1].luggagePieces = 8; else e.components[1].seatsPerVehicle = 8;
    assert.equal(transport(e, b).candidates.find(x => x.id === "all-hired")!.fit, "unsuitable");
  }
});
test("a group of nine cannot self-drive two cars with only one willing driver", () => {
  const b = sonomaTransportBrief(); b.willingDrivers = 1;
  const c = transport(transportFixtureExtraction(), b);
  assert.equal(c.candidates.find(x => x.id === "self-drive")!.fit, "unsuitable");
  assert.equal(c.candidates.find(x => x.id === "all-hired")!.fit, "conditional");
});
test("airport drivers can keep a hybrid viable without volunteering for winery day", () => {
  const b = sonomaTransportBrief(); b.startsOn = "2026-11-05"; b.endsOn = "2026-11-07";
  b.luggagePieces = 9;
  b.legs.forEach(leg => { leg.willingDrivers = leg.id === "wineries" ? 0 : 2; });
  const c = transport(transportFixtureExtraction(b), b);
  assert.equal(c.question, null);
  assert.equal(c.candidates.find(x => x.id === "self-drive")!.fit, "unsuitable");
  assert.equal(c.candidates.find(x => x.id === "rental-driver")!.fit, "conditional");
  assert.equal(c.candidates.find(x => x.id === "transfers-driver")!.fit, "conditional");
  assert.match(c.candidates.find(x => x.id === "self-drive")!.reasons.join(" "), /Friday.*not enough willing sober drivers/);
});
test("driver answer leads to luggage question, and explicit zero answers do not loop", () => {
  const b = sonomaTransportBrief(); b.startsOn = "2026-11-05"; b.endsOn = "2026-11-07";
  b.legs.forEach(leg => { leg.willingDrivers = 0; });
  assert.match(transport(transportFixtureExtraction(b), b).question!, /How many bags/);
  b.luggagePieces = 0;
  assert.equal(transport(transportFixtureExtraction(b), b).question, null);
  b.willingDrivers = 2; b.legs[1].willingDrivers = null;
  assert.match(transport(transportFixtureExtraction(b), b).question!, /sober drivers/);
});
test("airport-only quote is not a whole-trip transport solution", () => {
  const e = transportFixtureExtraction(); e.packages = [{ id: "airport-only", label: "Airport transfer only", family: "all_hired", componentIds: ["transfers"] }];
  const c = transport(e).candidates[0]; assert.equal(c.fit, "unsuitable"); assert.equal(c.price.completeness, "partial_reference");
  assert.match(c.reasons.join(" "), /Friday.*missing coverage/);
});
test("changed airport, flight timing or Schramsberg stop invalidates matching transport leg", () => {
  const b = sonomaTransportBrief(); b.legs[2].requirementVersion = "lodge-schramsberg-sfo-v2";
  const c = transport(transportFixtureExtraction(), b);
  for (const option of c.candidates) { assert.equal(option.fit, "unsuitable"); assert.match(option.reasons.join(" "), /different trip requirements/); }
});
test("same headcount but a stale checked party cannot be reused", () => {
  const e = transportFixtureExtraction(); e.components[1].covers[0].partySize = 8;
  assert.equal(transport(e).candidates.find(x => x.id === "all-hired")!.fit, "unsuitable");
});
test("taxes and fees unknown or excluded never become an all-in total", () => {
  for (const fees of ["unknown", "excluded"] as const) {
    const e = transportFixtureExtraction(); e.components[1].price.fees = fees;
    assert.equal(transport(e).candidates.find(x => x.id === "all-hired")!.price.completeness, "partial_reference");
  }
});
test("mixed currencies and missing unit multipliers prevent false total comparisons", () => {
  const e = transportFixtureExtraction(); e.components[2].price.currency = "EUR";
  assert.equal(transport(e).candidates.find(x => x.id === "transfers-driver")!.price.subtotalCents, null);
  e.components[1].price.basis = "per_unit"; assert.equal(transport(e).candidates.find(x => x.id === "all-hired")!.price.subtotalCents, null);
});
test("explicit units multiply exactly; per-person pricing must match the checked group", () => {
  const e = transportFixtureExtraction(); e.components[1].price = { ...e.components[1].price, amount: "100.25", basis: "per_person" }; e.components[1].pricedUnits = 9;
  assert.equal(transport(e).candidates.find(x => x.id === "all-hired")!.price.subtotalCents, 90225);
  e.components[1].pricedUnits = 8; assert.equal(transport(e).candidates.find(x => x.id === "all-hired")!.price.subtotalCents, null);
});
test("incomplete request-only price is not a quote, even if an amount was extracted", () => {
  const e = transportFixtureExtraction(); e.components[1].quoteState = "request_only";
  assert.equal(transport(e).candidates.find(x => x.id === "all-hired")!.price.subtotalCents, null);
});
test("overlapping bundles cannot silently double-charge or pretend coverage is complete", () => {
  const e = transportFixtureExtraction(); e.packages = [{ id: "duplicate-route", label: "Overlapping route", family: "rental_and_driver", componentIds: ["rental-all", "winery-driver"] }];
  const c = transport(e).candidates[0]; assert.equal(c.fit, "unsuitable"); assert.match(c.reasons.join(" "), /double charge/);
});
test("contract rejects duplicate charging of the same component", () => {
  const e = transportFixtureExtraction(); e.packages[0].componentIds.push("rental-all");
  assert.equal(DecisionExtractionSchema.safeParse(e).success, false);
});
test("a repeated component identity cannot replace its previous evidence", () => {
  const e = transportFixtureExtraction(); e.components.push(clone(e.components[1]));
  assert.ok(!transport(e).candidates.some(x => x.id === "all-hired"));
});
test("money uses exact supported minor units and rejects ambiguous precision", () => {
  assert.equal(referenceAmountCents("0.29", "USD"), 29); assert.equal(referenceAmountCents("999999999999.99", "USD"), 99999999999999);
  assert.equal(referenceAmountCents("100", "JPY"), null); assert.equal(referenceAmountCents("1.001", "USD"), null);
});
test("refinement preserves artifact identity and notes; recomparison preserves known choices", () => {
  const first = wineries(); const edited = refineResearchComparison(first, { actorId: decisionFixture.actor, expectedRevision: 1,
    taskId: first.taskId, threadId: first.threadId, briefRevision: first.briefRevision,
    contextRevision: first.contextRevision, selectedIds: ["flowers"], notes: [{ candidateId: "flowers", text: "Keep this as a candidate, not a booking." }] });
  const b = sonomaWineryBrief(); b.revision++; b.contextRevision = "sonoma-context-2";
  const next = compareResearchDecision({ brief: b, sources: decisionSources(), extraction: wineryFixtureExtraction(), comparisonId: decisionFixture.task, previous: edited });
  assert.equal(next.id, first.id); assert.equal(next.revision, 3); assert.deepEqual(next.selectedIds, ["flowers"]); assert.deepEqual(next.notes, edited.notes);
});
test("refinement rejects another organizer, stale revision and changed trip context", () => {
  const c = wineries();
  for (const patch of [{ actorId: decisionFixture.thread }, { expectedRevision: 0 }, { contextRevision: "new" }]) assert.throws(() => refineResearchComparison(c,
    { actorId: c.ownerId, taskId: c.taskId, threadId: c.threadId, briefRevision: c.briefRevision,
      expectedRevision: c.revision, contextRevision: c.contextRevision, selectedIds: [], notes: [], ...patch }));
});
test("a renewed job cannot accept old edits when artifact id, version and context are unchanged", () => {
  const old = wineries(), current = { ...old, taskId: decisionFixture.thread, briefRevision: old.briefRevision + 1 };
  assert.throws(() => refineResearchComparison(current, { actorId: old.ownerId, taskId: old.taskId, threadId: old.threadId,
    briefRevision: old.briefRevision, expectedRevision: old.revision, contextRevision: old.contextRevision, selectedIds: [], notes: [] }));
});
test("comparison cannot migrate across tasks or threads", () => {
  const b = sonomaWineryBrief(); b.threadId = decisionFixture.task;
  assert.throws(() => compareResearchDecision({ brief: b, sources: decisionSources(), extraction: wineryFixtureExtraction(), comparisonId: decisionFixture.artifact, previous: wineries() }));
});
test("common Trip Context fact ids and numeric/timestamp versions survive without renaming", () => {
  const b = sonomaWineryBrief(); b.factRefs = [{ id: `stay:${decisionFixture.artifact}`, version: "2026-10-03T12:00:00Z" }, { id: "trip", version: 0 }];
  assert.deepEqual(wineries(wineryFixtureExtraction(), b).factRefs, b.factRefs);
});
test("winery and transport comparisons cannot replace each other under a reused task id", () => {
  assert.throws(() => compareResearchDecision({ brief: sonomaTransportBrief(), sources: decisionSources(), extraction: transportFixtureExtraction(),
    comparisonId: decisionFixture.artifact, previous: wineries() }), /different job kind/);
});
test("brief rejects duplicate leg identities, reversed dates and out-of-scope party sizes", () => {
  for (const change of [(b: ReturnType<typeof sonomaTransportBrief>) => b.legs.push(clone(b.legs[0])),
    (b: ReturnType<typeof sonomaTransportBrief>) => { b.startsOn = "2026-11-07"; b.endsOn = "2026-11-05"; },
    (b: ReturnType<typeof sonomaTransportBrief>) => { b.legs[0].partySize = 10; }]) {
    const b = sonomaTransportBrief(); change(b); assert.equal(ResearchDecisionBriefSchema.safeParse(b).success, false);
  }
});
test("retrospective holdouts preserve known location but do not recover historical inventory", () => {
  for (const which of ["sea-island", "hawaiifest"] as const) {
    const b = retrospectiveDecisionBrief(which); const c = transport({ findings: [], components: [], packages: [] }, b);
    assert.equal(c.candidates.length, 0); assert.equal(c.booking, "not_booked"); assert.ok(c.question);
    assert.equal(b.willingDrivers, null); assert.equal(b.luggagePieces, null);
  }
  assert.match(retrospectiveDecisionBrief("hawaiifest").title, /Kentucky/); assert.match(retrospectiveDecisionBrief("sea-island").title, /Georgia/);
});
for (const kind of ["winery", "transport"] as const) test(`${kind}: no usable evidence cannot complete a dated research decision`, () => {
  const brief = { ...(kind === "winery" ? sonomaWineryBrief() : sonomaTransportBrief()),
    startsOn: "2026-11-05", endsOn: "2026-11-07", willingDrivers: 2, luggagePieces: 9 };
  // A captured page is not enough: none of its claims were accepted for an option.
  const c = compareResearchDecision({ brief, sources: decisionSources(), extraction: { findings: [], components: [], packages: [] },
    comparisonId: decisionFixture.artifact, mode: "fixture" });
  assert.match(c.question!, /couldn’t find enough source evidence/);
  assert.ok(c.candidates.every(candidate => candidate.sources.length === 0));
  assert.equal(c.booking, "not_booked"); assert.equal(c.approval, "not_requested");
});
