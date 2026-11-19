import test from "node:test";
import assert from "node:assert/strict";
import type { WineryFinding } from "@commons/contracts";
import { compareResearchDecision } from "./research-decision";
import { decisionFixture, decisionSources, wineryFixtureExtraction, sonomaWineryBrief } from "./research-decision-fixture";
import { wineryExperienceBrief, wineryExperienceSources, primaryWineryFinding as finding } from "./research-winery-experience-fixture";

const compare = (findings: WineryFinding[], day: "Friday" | "Saturday" = "Friday") => compareResearchDecision({
  brief: wineryExperienceBrief(day), sources: wineryExperienceSources, extraction: { findings, components: [], packages: [] }, comparisonId: decisionFixture.artifact, mode: "public_reference" });
const flowers = (field: WineryFinding["field"], value: WineryFinding["value"], quote: string) => finding("flowers", "flowers-primary", "estate", "ESTATE VINEYARD IMMERSION", field, value, quote);

test("public winery arithmetic holds legacy unscoped findings even with exact quote matches", () => {
  const c = compareResearchDecision({ brief: sonomaWineryBrief(), sources: decisionSources(), extraction: wineryFixtureExtraction(), comparisonId: decisionFixture.artifact });
  assert.ok(c.candidates.every(item => item.fit === "conditional" && item.price.subtotalCents === null));
  assert.match(c.limitations.join(" "), /without a captured regular in-person experience/);
});
test("Flowers group inquiry is not a hard maximum excluding nine travelers", () => {
  const c = compare([flowers("inquiryAboveParty", 6, "groups larger than six")]).candidates.find(n => n.id === "flowers")!;
  assert.equal(c.fit, "conditional"); assert.match(c.reasons.join(" "), /not a hard capacity limit/);
  assert.doesNotMatch(c.reasons.join(" "), /6 is below 9/);
});
test("Flowers Journey price cannot be merged into Estate Immersion", () => {
  const c = compare([flowers("inquiryAboveParty", 6, "groups larger than six"),
    finding("flowers", "flowers-primary", "journey", "SONOMA COAST JOURNEY", "pricePerPersonCents", 7500, "Non-Members | $75 per person")]).candidates.find(n => n.id === "flowers")!;
  assert.equal(c.fit, "conditional"); assert.equal(c.price.subtotalCents, null); assert.match(c.reasons.join(" "), /single tasting experience/);
});
test("same experience ID with contradictory names is not one product", () => {
  const other = finding("flowers", "flowers-primary", "estate", "SONOMA COAST JOURNEY", "pricePerPersonCents", 7500, "Non-Members | $75 per person");
  assert.match(compare([flowers("inquiryAboveParty", 6, "groups larger than six"), other]).candidates.find(n => n.id === "flowers")!.reasons.join(" "), /single tasting experience/);
});
test("Schramsberg private-tour weekday policy flags Saturday, not every trip day", () => {
  const row = finding("schramsberg", "schramsberg-primary", "private-tour", "PRIVATE TOUR & TASTING", "visitDays", "Sunday, Monday, Tuesday, Wednesday, Thursday", "Available Sunday – Thursday Mornings Only");
  const c = compare([row], "Saturday").candidates.find(n => n.id === "schramsberg")!;
  assert.equal(c.fit, "unsuitable"); assert.match(c.reasons.join(" "), /do not match/);
});
test("Schramsberg tasting-only limit cannot become private-tour capacity", () => {
  const rows = [finding("schramsberg", "schramsberg-primary", "private-tour", "PRIVATE TOUR & TASTING", "visitDays", "Sunday, Monday, Tuesday, Wednesday, Thursday", "Available Sunday – Thursday Mornings Only"),
    finding("schramsberg", "schramsberg-primary", "tasting-only", "TASTING ONLY EXPERIENCES", "maximumParty", 6, "(Maximum of Six People)")];
  const c = compare(rows).candidates.find(n => n.id === "schramsberg")!;
  assert.equal(c.fit, "conditional"); assert.doesNotMatch(c.reasons.join(" "), /6 is below 9/);
});
test("DaVero large-group rate remains partial and currency is not invented", () => {
  const row = finding("davero", "davero-primary", "pairing", "The Pairing Experience", "pricePerPersonCents", 6500, "Large Group $65 per guest + 20% gratuity");
  const c = compare([row]).candidates.find(n => n.id === "davero")!;
  assert.equal(c.price.subtotalCents, null); assert.equal(c.price.currency, null); assert.equal(c.fit, "conditional");
});
test("retail wine packs, virtual tastings and dated events do not populate regular visit arithmetic", () => {
  for (const kind of ["retail_product", "virtual", "dated_event"] as const) {
    const row = flowers("pricePerPersonCents", 13000, "Non-Members | $130 per person"); row.experience!.kind = kind;
    assert.equal(compare([row]).candidates.find(n => n.id === "flowers")!.price.subtotalCents, null);
    assert.match(compare([row]).limitations.join(" "), /held for review/);
  }
});
test("experience heading must be captured in the finding's own source, not another source", () => {
  const row = flowers("pricePerPersonCents", 13000, "Non-Members | $130 per person");
  row.experience!.name = "The Pairing Experience"; row.experience!.quote = "The Pairing Experience";
  assert.match(compare([row]).limitations.join(" "), /held for review/);
});
test("a contact threshold mislabeled by the model cannot exclude a group as over capacity", () => {
  const c = compare([flowers("maximumParty", 6, "groups larger than six")]);
  assert.equal(c.booking, "not_booked"); assert.equal(c.approval, "not_requested");
  assert.equal(c.candidates.find(n => n.id === "flowers")!.fit, "conditional");
  assert.match(c.limitations.join(" "), /quote did not state a clear capacity limit/);
});
test("explicit maximum of six people remains a scoped capacity limit", () => {
  const row = finding("schramsberg", "schramsberg-primary", "tasting-only", "TASTING ONLY EXPERIENCES", "maximumParty", 6, "(Maximum of Six People)");
  assert.equal(compare([row]).candidates.find(n => n.id === "schramsberg")!.fit, "unsuitable");
});
test("capacity quote must support the claimed number, not another price or ticket count", () => {
  const heading = "SYNTHETIC EXPERIENCE";
  for (const [quote, maximum, expected] of [
    ["Maximum group size: 6 guests. The price is $9.", 9, "conditional"],
    ["Maximum group size: 6 guests.", 6, "unsuitable"],
    ["Up to six guests.", 6, "unsuitable"],
    ["220 tickets available for this event.", 20, "conditional"],
    ["There is no maximum of six guests.", 6, "conditional"],
    ["For parties of nine, call us for availability.", 9, "conditional"],
  ] as const) {
    const source = { ...wineryExperienceSources[0], sourceId: "synthetic-capacity", excerpt: `${heading}\n${quote}` };
    const row = finding("flowers", source.sourceId, "synthetic", heading, "maximumParty", maximum, quote);
    const c = compareResearchDecision({ brief: wineryExperienceBrief(), sources: [source], extraction: { findings: [row], components: [], packages: [] }, comparisonId: decisionFixture.artifact, mode: "public_reference" });
    assert.equal(c.candidates.find(n => n.id === "flowers")!.fit, expected, quote);
  }
});
