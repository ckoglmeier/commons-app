import { z } from "zod";
import { InventoryPriceSchema } from "./discovery";

const id = z.string().regex(/^[a-zA-Z0-9_:-]{1,120}$/);
const text = z.string().trim().min(1).max(500);
const ref = z.object({ runId: z.string().uuid(), sourceId: id }).strict();
const unique = (items: string[]) => new Set(items).size === items.length;
export const DecisionSourceSchema = z.object({
  ...ref.shape, url: z.string().url().max(2048), title: z.string().max(240),
  excerpt: z.string().max(5000), retrievedAt: z.string().datetime(),
  coverage: z.enum(["snippet", "page"]), provider: text,
}).strict();
export type DecisionSource = z.infer<typeof DecisionSourceSchema>;
// Preserve the shared Trip Context's row version OR updatedAt fingerprint.
export const DecisionFactRefSchema = z.object({ id, version: z.union([z.number().int().nonnegative(), z.string().min(1).max(80)]) }).strict();

export const ResearchDecisionBriefSchema = z.object({
  schemaVersion: z.literal(1), kind: z.enum(["winery", "transport"]),
  taskId: z.string().uuid(), threadId: z.string().uuid(), ownerId: z.string().uuid(),
  revision: z.number().int().positive(), contextRevision: z.string().min(1).max(128),
  recipe: z.object({ key: text, version: z.number().int().positive() }).strict(),
  title: z.string().trim().min(1).max(160), partySize: z.number().int().min(1).max(100),
  startsOn: z.string().date().nullable(), endsOn: z.string().date().nullable(),
  nominated: z.array(z.object({ id, name: z.string().trim().min(1).max(120), priority: z.boolean(), memberConnection: z.boolean() }).strict()).max(20),
  requestedWeekdays: z.array(z.enum(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"])).max(7),
  legs: z.array(z.object({
    id, label: text, origin: text.nullable(), destination: text.nullable(), date: z.string().date().nullable(), partySize: z.number().int().min(1).max(100),
    /** A common-context version/fingerprint, including route/stops/flight timing. */
    requirementVersion: text, needsLuggage: z.boolean(),
    /** Reviewed availability for this leg. Absent preserves legacy whole-trip input;
     * explicit null means unknown and must not fall back to a different answer. */
    willingDrivers: z.number().int().min(0).max(20).nullable().optional(),
  }).strict()).max(12),
  luggagePieces: z.number().int().min(0).max(200).nullable(),
  willingDrivers: z.number().int().min(0).max(20).nullable(),
  /** Reviewed, minimized PUBLIC queries only. No raw thread or automatic scope expansion. */
  queries: z.array(z.object({ id, text: z.string().trim().min(1).max(500), followUpFor: id.nullable() }).strict()).max(12),
  factRefs: z.array(DecisionFactRefSchema).max(50),
}).strict().superRefine((b, ctx) => {
  if (b.startsOn && b.endsOn && b.endsOn < b.startsOn) ctx.addIssue({ code: "custom", message: "Trip dates are reversed." });
  for (const [label, ids] of [["candidates", b.nominated.map(x => x.id)], ["legs", b.legs.map(x => x.id)], ["queries", b.queries.map(x => x.id)], ["facts", b.factRefs.map(x => x.id)]] as const) {
    if (!unique([...ids])) ctx.addIssue({ code: "custom", message: `Duplicate ${label}.` });
  }
  if (b.kind === "winery" && !b.nominated.length || b.kind === "transport" && !b.legs.length) ctx.addIssue({ code: "custom", message: "The job needs its candidates or required legs." });
  if (b.legs.some(x => x.partySize > b.partySize || x.date && (b.startsOn && x.date < b.startsOn || b.endsOn && x.date > b.endsOn))) ctx.addIssue({ code: "custom", message: "Transport requirements exceed the trip scope." });
  if (b.willingDrivers !== null && b.willingDrivers > b.partySize || b.legs.some(x => x.willingDrivers != null && x.willingDrivers > x.partySize)) ctx.addIssue({ code: "custom", message: "Willing drivers exceed the selected party." });
  if (b.queries.some(x => x.followUpFor && !b.nominated.some(n => n.id === x.followUpFor))) ctx.addIssue({ code: "custom", message: "Unknown follow-up candidate." });
});
export type ResearchDecisionBrief = z.infer<typeof ResearchDecisionBriefSchema>;

/** Advisory extraction. Quotes are checked against captured text; no action/authority fields. */
export const WineryFindingSchema = z.object({
  candidateId: id, field: z.enum(["maximumParty", "inquiryAboveParty", "membersOnly", "visitDays", "pricePerPersonCents", "currency", "location"]),
  value: z.union([z.number().int().nonnegative().max(100_000_000), z.boolean(), z.string().min(1).max(300)]),
  source: ref, quote: z.string().min(1).max(1000),
  /** Advisory product identity, not semantic verification or authority. Optional
   * only for old synthetic captures; public winery arithmetic requires a scoped
   * regular in-person experience, with its heading in the same captured source.
   */
  experience: z.object({ id, name: z.string().trim().min(1).max(120),
    kind: z.enum(["regular_in_person", "dated_event", "retail_product", "virtual"]),
    quote: z.string().min(1).max(300) }).strict().optional(),
}).strict();
export type WineryFinding = z.infer<typeof WineryFindingSchema>;

export const TransportComponentSchema = z.object({
  id, supplier: z.string().min(1).max(160), mode: z.enum(["rental", "hired"]),
  covers: z.array(z.object({ legId: id, requirementVersion: text, partySize: z.number().int().positive().max(100) }).strict()).min(1).max(12),
  vehicleCount: z.number().int().positive().max(20), seatsPerVehicle: z.number().int().positive().max(100).nullable(),
  luggagePieces: z.number().int().nonnegative().max(200).nullable(),
  price: InventoryPriceSchema,
  /** Multipliers come from the explicitly checked request, not inferred by the model. */
  pricedUnits: z.number().int().positive().max(100).nullable(),
  quoteState: z.enum(["reference", "request_only", "fixture"]),
  sources: z.array(ref).min(1).max(5),
  /** Verbatim captured support. A reference is never upgraded to a current offer. */
  evidenceQuote: z.string().min(1).max(2000),
}).strict().refine(c => unique(c.covers.map(x => x.legId)), "A component cannot repeat a leg.");
export type TransportComponent = z.infer<typeof TransportComponentSchema>;
export const TransportPackageSchema = z.object({
  id, label: text, family: z.enum(["self_drive", "all_hired", "transfers_and_driver", "rental_and_driver"]),
  componentIds: z.array(id).min(1).max(12),
}).strict().refine(p => unique(p.componentIds), "A package cannot charge the same component twice.");
export type TransportPackage = z.infer<typeof TransportPackageSchema>;
export const DecisionExtractionSchema = z.object({
  findings: z.array(WineryFindingSchema).max(100),
  components: z.array(TransportComponentSchema).max(20), packages: z.array(TransportPackageSchema).max(8),
}).strict();
export type DecisionExtraction = z.infer<typeof DecisionExtractionSchema>;

export const DecisionCandidateSchema = z.object({
  id, label: text, kind: z.enum(["winery", "transport"]),
  fit: z.enum(["supported", "conditional", "unsuitable"]),
  reasons: z.array(text).max(30), sources: z.array(ref).max(30),
  /** Always a reference/fixture calculation; not a qualified current supplier offer. */
  price: z.object({ subtotalCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
    perPersonCents: z.number().int().nonnegative().nullable(), currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
    completeness: z.enum(["all_in_reference", "partial_reference", "unknown"]),
    kind: z.enum(["reference", "fixture"]),
  }).strict(),
  coverage: z.array(id).max(12),
}).strict();
export type DecisionCandidate = z.infer<typeof DecisionCandidateSchema>;
export const ResearchDecisionComparisonSchema = z.object({
  schemaVersion: z.literal(1), id: z.string().uuid(), revision: z.number().int().positive(),
  kind: z.enum(["winery", "transport"]),
  taskId: z.string().uuid(), threadId: z.string().uuid(), ownerId: z.string().uuid(),
  briefRevision: z.number().int().positive(), contextRevision: text,
  evidenceMode: z.enum(["fixture", "public_reference"]),
  title: z.string().max(160), candidates: z.array(DecisionCandidateSchema).max(20),
  selectedIds: z.array(id).max(20), notes: z.array(z.object({ candidateId: id, text: z.string().max(1000) }).strict()).max(30),
  question: z.string().max(500).nullable(), limitations: z.array(text).max(20),
  sourceRefs: z.array(ref).max(60), factRefs: z.array(DecisionFactRefSchema).max(50),
  approval: z.literal("not_requested"), booking: z.literal("not_booked"),
}).strict().superRefine((c, ctx) => {
  const ids = c.candidates.map(x => x.id);
  if (!unique(ids) || !unique(c.selectedIds)) ctx.addIssue({ code: "custom", message: "Duplicate comparison identity." });
  if (c.selectedIds.some(x => !ids.includes(x)) || c.notes.some(x => !ids.includes(x.candidateId))) ctx.addIssue({ code: "custom", message: "Unknown selected/noted candidate." });
});
export type ResearchDecisionComparison = z.infer<typeof ResearchDecisionComparisonSchema>;

export const ResearchDecisionCheckpointSchema = z.object({
  schemaVersion: z.literal(1), revision: z.number().int().positive(), taskId: z.string().uuid(), briefRevision: z.number().int().positive(),
  contextRevision: text, recipeKey: text, recipeVersion: z.number().int().positive(), policyVersion: text,
  phase: z.enum(["search", "extract", "compare", "done"]),
  queryIndex: z.number().int().nonnegative(), extractedSourceCount: z.number().int().nonnegative(),
  callsUsed: z.number().int().nonnegative().max(20),
  sources: z.array(DecisionSourceSchema).max(60), extraction: DecisionExtractionSchema,
  limitations: z.array(text).max(20),
}).strict();
export type ResearchDecisionCheckpoint = z.infer<typeof ResearchDecisionCheckpointSchema>;
