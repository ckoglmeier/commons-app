import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { optionCoverage, qualifyOption, refineShortlist, shortlistError, shortlistFromChoices, sourceBasis, syncDecisionOptions, participantOptionDetails, type DecisionScope, type EvidenceRow } from "./activity-shortlist";

/*
 * Captured-response checks. Excerpts are the committed, shortened October 16 Sonoma
 * captures (real Perplexity/Sol returns through the privacy boundary). These verify
 * behavior against what was captured, not current supplier truth.
 */
const saved = JSON.parse(readFileSync(fileURLToPath(new URL("../../../docs/releases/2026-10-19/evidence/sonoma-saved-state.json", import.meta.url)), "utf8"));
const evidence: EvidenceRow[] = saved.research.sources.map((row: EvidenceRow) => ({ runId: row.runId, sourceId: row.sourceId, title: row.title, url: row.url, excerpt: row.excerpt, retrievedAt: row.retrievedAt }));
const friday: DecisionScope = { partySize: 9, day: "2026-11-06", requirements: ["group_policy", "eligible_day", "price_basis"] };
const thursday: DecisionScope = { ...friday, day: "2026-11-05" };
const item = { id: "friday-winery", sources: evidence.map(row => ({ runId: row.runId, sourceId: row.sourceId })), location: "Sonoma / Napa" };

test("source basis is code-derived from host and option name, never asserted", () => {
  assert.equal(sourceBasis("Schramsberg Vineyards", "https://www.schramsberg.com/faq/"), "primary");
  assert.equal(sourceBasis("DaVero Farms & Winery", "https://glassandnote.com/food/best-wineries-in-sonoma"), "secondary");
  assert.equal(sourceBasis("Flowers Vineyards & Winery", "https://www.wineroad.com/explore/dry-creek-valley/"), "secondary");
  // Generic words alone never make a source primary.
  assert.equal(sourceBasis("Sonoma Winery", "https://sonomawinery.example/"), "secondary");
});

test("Sonoma captured comparison: predeclared material checks for nine on Friday", () => {
  const [schramsberg, flowers, davero] = shortlistFromChoices(item, ["Schramsberg Vineyards", "Flowers Vineyards & Winery", "DaVero Farms & Winery"], evidence, friday);
  // Schramsberg: primary sources state parties of 7+ must arrange a private tour,
  // offered Sunday–Thursday only. Friday therefore cannot work for nine.
  assert.equal(schramsberg.fit, "unsuitable");
  assert.ok(schramsberg.sources.every(source => source.basis === "primary"));
  assert.match(schramsberg.reasons.join(" "), /Sunday–Thursday only, not Friday/);
  const coverage = optionCoverage(schramsberg, evidence, friday);
  assert.equal(coverage.find(row => row.requirement === "group_policy")!.status, "conditional");
  assert.equal(coverage.find(row => row.requirement === "eligible_day")!.status, "contradicted");
  // The $65 published price is a public-tour price, not a group quote.
  assert.deepEqual(schramsberg.price && { amount: schramsberg.price.amountCents, basis: schramsberg.price.basis, kind: schramsberg.price.kind }, { amount: 6500, basis: "per_person", kind: "reference" });
  assert.ok(schramsberg.unknowns.some(text => /may not apply to this group/.test(text)));
  // Flowers: no captured source at all. Unknown is not viability.
  assert.equal(flowers.fit, "requires_confirmation");
  assert.equal(flowers.sources.length, 0);
  assert.deepEqual(flowers.unknowns, ["Group rules for 9: not confirmed", "Friday availability: not confirmed", "Price and what it covers: not confirmed"]);
  // DaVero: only a secondary multi-winery article; nothing in its DaVero section answers the questions,
  // and other wineries' limits in the same article are not attributed to DaVero.
  assert.equal(davero.fit, "requires_confirmation");
  assert.ok(davero.sources.length >= 1 && davero.sources.every(source => source.basis === "secondary"));
  assert.equal(davero.price, null);
  assert.ok(!davero.reasons.some(text => /six/i.test(text)));
});

test("resolving the day constraint re-qualifies the same option without inventing viability", () => {
  const [schramsberg] = shortlistFromChoices(item, ["Schramsberg Vineyards"], evidence, thursday);
  const coverage = optionCoverage(schramsberg, evidence, thursday);
  assert.equal(coverage.find(row => row.requirement === "eligible_day")!.status, "primary");
  // Still requires the winery to accept the private booking: needs confirmation, not viable.
  assert.equal(schramsberg.fit, "requires_confirmation");
  assert.ok(schramsberg.unknowns.some(text => /Parties of 7 or more must arrange a separate booking/.test(text)));
});

test("a claimed candidate cannot exceed evidence; an explicit capacity shortfall is unsuitable", () => {
  const scope: DecisionScope = { partySize: 9, day: "2026-11-06", requirements: ["capacity", "price_basis"] };
  const rows: EvidenceRow[] = [{ runId: "11111111-1111-4111-8111-111111111111", sourceId: "v1", title: "Valley Vans", url: "https://www.valleyvans.example/fleet", excerpt: "Our Sprinter seats 12 passengers. Wine tours from $120 per hour.", retrievedAt: "2026-10-16T00:00:00.000Z" },
    { runId: "11111111-1111-4111-8111-111111111111", sourceId: "v2", title: "Tiny Tours", url: "https://www.tinytours.example/", excerpt: "Our sedan carries up to 4 passengers.", retrievedAt: "2026-10-16T00:00:00.000Z" }];
  const base = { fit: "candidate" as const, reasons: [], unknowns: [], price: null, location: null, note: "", keep: false, inPoll: true, planItemId: null };
  const vans = qualifyOption({ ...base, id: "vans", label: "Valley Vans", sources: [{ runId: rows[0].runId, sourceId: "v1", basis: "secondary" }] }, rows, scope);
  assert.equal(vans.fit, "candidate");
  assert.equal(vans.sources[0].basis, "primary");
  assert.deepEqual([vans.price?.amountCents, vans.price?.basis], [12000, "per_hour"]);
  const tiny = qualifyOption({ ...base, id: "tiny", label: "Tiny Tours", sources: [{ runId: rows[0].runId, sourceId: "v2", basis: "primary" }] }, rows, scope);
  assert.equal(tiny.fit, "unsuitable");
  const unsourced = qualifyOption({ ...base, id: "x", label: "Unsourced Limo", sources: [] }, rows, scope);
  assert.equal(unsourced.fit, "requires_confirmation");
});

test("keep these two, find a cheaper third: retained options keep identity, notes, sources and price", () => {
  const first = shortlistFromChoices(item, ["Schramsberg Vineyards", "Flowers Vineyards & Winery", "DaVero Farms & Winery"], evidence, thursday)
    .map((option, index) => index < 2 ? { ...option, keep: true, note: index === 0 ? "Ask about 9:30 slot" : "Member friend may help" } : option);
  const refined = refineShortlist(first, ["Schramsberg Vineyards", "Flowers Vineyards & Winery", "Bedrock Wine Co."], item, evidence, thursday);
  assert.deepEqual(refined.slice(0, 2), first.slice(0, 2));
  assert.equal(refined.length, 3);
  assert.equal(refined[2].label, "Bedrock Wine Co.");
  assert.notEqual(refined[2].id, first[2].id);
  assert.ok(!refined.some(option => option.label.startsWith("DaVero")));
  // Bedrock appears only in a secondary article: no viability from it.
  assert.equal(refined[2].fit, "requires_confirmation");
  // A label the organizer did not retain but the refinement re-proposes keeps its identity.
  const again = refineShortlist(refined, ["Schramsberg Vineyards", "Flowers Vineyards & Winery", "Bedrock Wine Co."], item, evidence, thursday);
  assert.equal(again[2].id, refined[2].id);
});

test("poll choices must match the human selection; unsuitable options cannot be asked or chosen", () => {
  const shortlist = shortlistFromChoices(item, ["Schramsberg Vineyards", "Flowers Vineyards & Winery", "DaVero Farms & Winery"], evidence, friday);
  assert.deepEqual(syncDecisionOptions(shortlist), ["Flowers Vineyards & Winery", "DaVero Farms & Winery"]);
  assert.match(shortlistError({ options: ["Flowers Vineyards & Winery", "DaVero Farms & Winery"], shortlist })!, /unsuitable/);
  const selected = shortlist.map(option => option.fit === "unsuitable" ? { ...option, inPoll: false } : option);
  assert.equal(shortlistError({ options: syncDecisionOptions(selected), shortlist: selected }), null);
  assert.match(shortlistError({ options: ["Flowers Vineyards & Winery", "Something else"], shortlist: selected })!, /must match/);
  assert.match(shortlistError({ options: syncDecisionOptions(selected), shortlist: selected, chosenOptionId: shortlist[0].id })!, /not unsuitable/);
  assert.equal(shortlistError({ options: syncDecisionOptions(selected), shortlist: selected, chosenOptionId: selected[1].id }), null);
});

test("participant option text carries only a public reference price and an unknown flag", () => {
  const [schramsberg, flowers] = shortlistFromChoices(item, ["Schramsberg Vineyards", "Flowers Vineyards & Winery"], evidence, thursday)
    .map(option => ({ ...option, note: "PRIVATE ORGANIZER NOTE" }));
  assert.equal(participantOptionDetails(schramsberg), "About $65 per person (reference captured 2026-10-16; check current rate; may not apply to this group) · Details still to confirm");
  assert.equal(participantOptionDetails(flowers), "Price not confirmed · Details still to confirm");
  assert.ok(![participantOptionDetails(schramsberg), participantOptionDetails(flowers)].some(text => /PRIVATE|Parties of 7/.test(text)));
});

test("a shortlist always asks about at least two options; scope follows the stop kind", async () => {
  const { decisionScopeFor } = await import("./activity-shortlist");
  const shortlist = shortlistFromChoices(item, ["Flowers Vineyards & Winery", "DaVero Farms & Winery"], evidence, thursday);
  const one = shortlist.map((option, index) => ({ ...option, inPoll: index === 0 }));
  assert.match(shortlistError({ options: ["Flowers Vineyards & Winery"], shortlist: one })!, /at least two/);
  assert.deepEqual(decisionScopeFor({ kind: "transport", day: "2026-11-06", partySize: 9 }).requirements, ["capacity", "eligible_day", "price_basis"]);
  assert.deepEqual(decisionScopeFor({ kind: "activity", day: null }).partySize, null);
});

test("model refinement keeps human shortlists: retained options verbatim, choice kept, dropped choices restored", async () => {
  const { preserveShortlists } = await import("./activity-shortlist");
  const shortlist = shortlistFromChoices(item, ["Schramsberg Vineyards", "Flowers Vineyards & Winery", "DaVero Farms & Winery"], evidence, thursday)
    .map((option, index) => ({ ...option, keep: index < 2, note: index === 1 ? "Ask the member" : "" }));
  type Item = Parameters<typeof preserveShortlists>[0][number];
  const before: Item = { ...item, kind: "activity", day: thursday.day, partySize: 9, decision: { question: "Which winery?", options: syncDecisionOptions(shortlist), shortlist, chosenOptionId: shortlist[1].id } };
  const proposed: Item = { ...before, partySize: undefined, decision: { question: "Which winery Thursday?", options: ["Schramsberg Vineyards", "Flowers Vineyards & Winery", "Bedrock Wine Co."] } };
  const [kept] = preserveShortlists([before], [proposed], evidence);
  assert.deepEqual(kept.decision!.shortlist!.slice(0, 2), shortlist.slice(0, 2));
  assert.equal(kept.decision!.shortlist![2].label, "Bedrock Wine Co.");
  assert.equal(kept.decision!.chosenOptionId, shortlist[1].id);
  assert.equal(kept.partySize, 9);
  assert.equal(shortlistError(kept.decision!), null);
  const [restored] = preserveShortlists([before], [{ ...before, decision: null }], evidence);
  assert.deepEqual(restored.decision, before.decision);
});

test("moving the stop to Thursday re-qualifies the same options and replaces Friday-specific text", async () => {
  const { requalifyShortlist, decisionScopeFor } = await import("./activity-shortlist");
  const friday9 = shortlistFromChoices(item, ["Schramsberg Vineyards", "Flowers Vineyards & Winery", "DaVero Farms & Winery"], evidence, friday)
    .map(option => ({ ...option, inPoll: option.fit !== "unsuitable", note: option.label.startsWith("Schram") ? "Call at 9" : "" }));
  assert.equal(friday9[0].fit, "unsuitable");
  const moved = requalifyShortlist(friday9, evidence, friday, thursday);
  assert.deepEqual(moved.map(option => option.id), friday9.map(option => option.id));
  assert.equal(moved[0].fit, "requires_confirmation");
  assert.equal(moved[0].note, "Call at 9");
  assert.equal(moved[0].inPoll, false, "re-asking a newly suitable option is the organizer's choice");
  assert.ok(!moved.some(option => option.unknowns.some(text => /Friday/.test(text)) || option.reasons.some(text => /not friday/i.test(text))));
  assert.ok(moved[1].unknowns.includes("Thursday availability: not confirmed"));
  assert.deepEqual(decisionScopeFor({ kind: "activity", day: "2026-11-05", partySize: 9 }), thursday);
});

test("review fixes: vague refusals, fleets, multiple day ranges and heading-less pages are read conservatively", async () => {
  const { readExcerpt, optionSection } = await import("./activity-shortlist");
  const scope: DecisionScope = { partySize: 9, day: "2026-11-06", requirements: ["group_policy", "eligible_day", "capacity"] };
  assert.equal(readExcerpt("We are unable to accommodate large parties at the bar.", scope).findings.group_policy?.status, "conditional");
  assert.equal(readExcerpt("We cannot accommodate groups larger than 6.", scope).findings.group_policy?.status, "no");
  assert.equal(readExcerpt("Fleet: 4-passenger sedan, 14-passenger Sprinter.", scope).findings.capacity?.status, "ok");
  assert.equal(readExcerpt("Private groups Mon–Thu; Fri–Sun by appointment.", scope).findings.eligible_day?.status, "ok");
  const page = "Flowers is a favorite for views.\n\nAnother winery is closed Fridays and cannot accommodate groups larger than 4.";
  assert.equal(optionSection("Flowers Vineyards & Winery", page).trim(), "Flowers is a favorite for views.");
});

test("refinement attaches newly captured evidence to an existing option without changing its identity or notes", async () => {
  const { preserveShortlists } = await import("./activity-shortlist");
  const run = "11111111-1111-4111-8111-111111111111";
  const first: EvidenceRow[] = [{ runId: run, sourceId: "a", title: "Guide", url: "https://guide.example/sonoma", excerpt: "## Flowers Vineyards & Winery\nCoastal views.", retrievedAt: "2026-10-16T00:00:00.000Z" }];
  const later: EvidenceRow[] = [...first, { runId: run, sourceId: "b", title: "Flowers visit", url: "https://www.flowerswinery.com/visit", excerpt: "Groups of up to 12 guests welcome by appointment. Open daily. $85 per person.", retrievedAt: "2026-10-17T00:00:00.000Z" }];
  const item0 = { id: "w", kind: "activity", day: "2026-11-06", location: "", partySize: 9, sources: [{ runId: run, sourceId: "a" }] };
  const shortlist = shortlistFromChoices(item0, ["Flowers Vineyards & Winery", "DaVero Farms & Winery"], first, friday).map(option => ({ ...option, keep: true, note: "keep this" }));
  assert.equal(shortlist[0].fit, "requires_confirmation");
  type Item = Parameters<typeof preserveShortlists>[0][number];
  const before: Item = { ...item0, decision: { question: "Which?", options: syncDecisionOptions(shortlist), shortlist, chosenOptionId: null } };
  const [after] = preserveShortlists([before], [<Item>{ ...before, sources: [{ runId: run, sourceId: "a" }, { runId: run, sourceId: "b" }], decision: { question: "Which?", options: ["Flowers Vineyards & Winery", "DaVero Farms & Winery"] } }], later);
  const flowers = after.decision!.shortlist![0];
  assert.deepEqual([flowers.id, flowers.note, flowers.keep], [shortlist[0].id, "keep this", true]);
  assert.equal(flowers.fit, "candidate");
  assert.ok(flowers.sources.some(source => source.sourceId === "b" && source.basis === "primary"));
});

test("participant projection of a shortlisted stop excludes notes, reasons, unknowns, unsuitable options, party size and the private choice", async () => {
  const { itineraryParticipantDraft, validateItineraryContent } = await import("./research-itinerary");
  const shortlist = shortlistFromChoices(item, ["Schramsberg Vineyards", "Flowers Vineyards & Winery", "DaVero Farms & Winery"], evidence, friday)
    .map(option => ({ ...option, inPoll: option.fit !== "unsuitable", note: "PRIVATE_NOTE_X" }));
  const content = { title: "Weekend", brief: "", items: [{ id: "friday-winery", kind: "activity" as const, title: "Winery visit", day: "2026-11-06", time: "10:00", location: "Sonoma", note: "", participation: "group" as const, alternative: false, evidence: "researched_claim" as const,
    sources: item.sources, unresolved: [], partySize: 9, decision: { question: "Which winery?", options: syncDecisionOptions(shortlist), shortlist, chosenOptionId: shortlist[1].id } }], tasks: [], driverBrief: "", unresolved: [] };
  let n = 0;
  const projected = JSON.stringify(itineraryParticipantDraft(content, () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, evidence));
  for (const hidden of ["PRIVATE_NOTE_X", "Schramsberg", "Parties of 7", "Still to confirm", "Group rules for", "partySize", "chosenOptionId", shortlist[1].id]) assert.ok(!projected.includes(hidden), hidden);
  assert.match(projected, /Flowers Vineyards & Winery/);
  // The server rejects a stored option claiming more than its evidence supports.
  const claimed = { ...content, items: [{ ...content.items[0], decision: { ...content.items[0].decision, shortlist: shortlist.map((option, index) => index === 1 ? { ...option, fit: "candidate" as const } : option) } }] };
  assert.throws(() => validateItineraryContent(claimed, { facts: { startsOn: "2026-11-05", endsOn: "2026-11-07", timezone: "America/Los_Angeles", hotels: [], flights: [] }, evidence, receipts: [], content: claimed }, { privateDocumentEdit: true }), /supporting evidence/);
});


test("release review: a matching word in an unrelated host is not supplier evidence", () => {
  assert.equal(sourceBasis("Flowers Vineyards & Winery", "https://flowers.travelblog.example/guide"), "secondary");
  assert.equal(sourceBasis("Flowers Vineyards & Winery", "https://flowers-reviews.example/guide"), "secondary");
  assert.equal(sourceBasis("Flowers Vineyards & Winery", "https://notflowerswinery.com/guide"), "secondary");
  assert.equal(sourceBasis("Flowers Vineyards & Winery", "https://flowerswinery.com.evil.example/guide"), "secondary");
  assert.equal(sourceBasis("Flowers Vineyards & Winery", "https://www.flowerswinery.com/visit"), "primary");
});

test("release review: explicit daily exceptions cannot qualify a closed day", async () => {
  const { readExcerpt } = await import("./activity-shortlist");
  const scope: DecisionScope = { partySize: 6, day: "2026-11-17", requirements: ["group_policy", "eligible_day", "price_basis"] };
  for (const text of ["Groups of up to 15 guests welcome. Open daily except Tuesday. $50 per person.", "Groups of up to 15 guests welcome. Open every day except on Tuesdays. $50 per person."]) {
    assert.equal(readExcerpt(text, scope).findings.eligible_day?.status, "no");
  }
  assert.equal(readExcerpt("Groups of up to 15 guests welcome. Open daily except Wednesday. $50 per person.", scope).findings.eligible_day?.status, "ok");
});

test("release review: a contradicted rule cannot be downgraded to an askable unknown", async () => {
  const { validateItineraryContent } = await import("./research-itinerary");
  const shortlist = shortlistFromChoices(item, ["Schramsberg Vineyards", "Flowers Vineyards & Winery", "DaVero Farms & Winery"], evidence, friday)
    .map(option => ({ ...option, fit: "requires_confirmation" as const, inPoll: true }));
  const content = { title: "Weekend", brief: "", items: [{ id: "friday-winery", kind: "activity" as const, title: "Winery visit", day: "2026-11-06", time: "10:00", location: "Sonoma", note: "", participation: "group" as const, alternative: false, evidence: "researched_claim" as const,
    sources: item.sources, unresolved: [], partySize: 9, decision: { question: "Which winery?", options: syncDecisionOptions(shortlist), shortlist, chosenOptionId: shortlist[0].id } }], tasks: [], driverBrief: "", unresolved: [] };
  assert.throws(() => validateItineraryContent(content, { facts: { startsOn: "2026-11-05", endsOn: "2026-11-07", timezone: "America/Los_Angeles", hotels: [], flights: [] }, evidence, receipts: [], content }, { privateDocumentEdit: true }), /supporting evidence/);
});

test("refinement preserves private notes, poll exclusions, chosen and linked options even without Keep", async () => {
  const { preserveShortlists } = await import("./activity-shortlist");
  const shortlist = shortlistFromChoices(item, ["Flowers Vineyards & Winery", "DaVero Farms & Winery", "Bedrock Wine Co.", "Excluded option"], [], friday)
    .map((option, index) => ({ ...option, keep: false, note: index === 0 ? "Return journey: ask about the garden" : "", inPoll: index !== 3,
      planItemId: index === 2 ? "96000000-0000-4000-8000-000000000201" : null }));
  type Item = Parameters<typeof preserveShortlists>[0][number];
  const before: Item = { ...item, kind: "activity", day: friday.day, partySize: 9,
    decision: { question: "Which winery?", options: syncDecisionOptions(shortlist), shortlist, chosenOptionId: shortlist[1].id } };
  const proposed: Item = { ...before, decision: { question: "Which winery?", options: ["Replacement A", "Replacement B"] } };
  const [after] = preserveShortlists([before], [proposed], []);
  for (const original of shortlist) {
    const retained = after.decision!.shortlist!.find(option => option.id === original.id);
    assert.ok(retained, `lost human-owned option ${original.label}`);
    assert.deepEqual([retained.note, retained.keep, retained.inPoll, retained.planItemId], [original.note, original.keep, original.inPoll, original.planItemId]);
  }
  assert.equal(after.decision!.chosenOptionId, shortlist[1].id);
  assert.equal(shortlistError(after.decision!), null);
});


test("resolved choices and optional questions stay private while new shared rounds ask only what remains", async () => {
 const { itineraryParticipantDraft, ItineraryProviderContentSchema } = await import("./research-itinerary");
 const { syntheticDraft } = await import("./fixtures/research-itinerary");
 const draft=syntheticDraft();
 const shortlist=shortlistFromChoices(item,["Flowers Vineyards & Winery","DaVero Farms & Winery"],[],friday);
 draft.content.items=[{...draft.content.items[1],id:item.id,decision:{question:"Which winery?",options:syncDecisionOptions(shortlist),shortlist}}];
 draft.content.questions=[{id:"driver",prompt:"Would you drive?"},{id:"lunch",prompt:"Lunch preference?"}];
 const id=()=>crypto.randomUUID();
 const old=itineraryParticipantDraft(draft.content,id), snapshot=JSON.stringify(old);
 draft.content.items[0].decision!.chosenOptionId=shortlist[0].id;
 draft.content.questions[0].resolved=true;
 const next=itineraryParticipantDraft(draft.content,id);
 const stop=next.questions.find(q=>q.kind==="choice")!;
 assert.ok(stop.kind==="choice" && stop.itinerary);
 assert.equal(stop.itinerary.days[0].items[0].choices,undefined);
 assert.match(stop.itinerary.days[0].items[0].title,/Flowers/);
 assert.deepEqual(next.questions.filter(q=>q.kind==="text").map(q=>q.prompt),["Lunch preference?"]);
 assert.equal(JSON.stringify(old),snapshot);assert.ok(old.questions[0].kind==="choice" && old.questions[0].itinerary?.days[0].items[0].choices);
 draft.content.items[0].decision!.chosenOptionId=null;draft.content.questions[0].resolved=false;
 const reopened=itineraryParticipantDraft(draft.content,id);
 assert.equal(reopened.questions.length,3);
 assert.ok(reopened.questions[0].kind==="choice" && reopened.questions[0].itinerary?.days[0].items[0].choices);
 assert.ok(!ItineraryProviderContentSchema.safeParse(draft.content).success,"model cannot assert a human resolution marker");
});
