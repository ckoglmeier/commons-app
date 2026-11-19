import { z } from "zod";

const id = z.string().uuid();
const label = z.string().trim().min(1).max(240);
const timestamp = z.string().datetime({ offset: true });
const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const timezone = z.string().max(80).refine(value => {
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}, "Use an IANA timezone.");
export const EvidenceUrlSchema = z.string().url().max(2048).refine(value => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
      && (!url.port || ["80", "443"].includes(url.port));
  } catch { return false; }
}, "Use an http(s) link without credentials or a custom port.");

export const InventoryPriceSchema = z.object({
  amount: z.string().regex(/^\d{1,12}(\.\d{1,6})?$/).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  basis: z.enum(["total", "per_person", "per_night", "per_person_per_night", "per_unit", "unknown"]),
  taxes: z.enum(["included", "excluded", "unknown"]),
  fees: z.enum(["included", "excluded", "unknown"]),
  coversAllRequestedComponents: z.boolean().nullable(),
}).strict();

// Reusable exploration evidence, never an inventory observation or an implied quote.
export const IndicativePriceSchema = z.object({
  kind: z.literal("indicative_price"),
  price: InventoryPriceSchema,
  assumptions: z.object({ dates: z.string().max(240).nullable(), occupancy: z.string().max(240).nullable(),
    duration: z.string().max(240).nullable(), components: z.array(label).max(30) }).strict(),
  asOf: timestamp.nullable(),
  validUntil: timestamp.nullable(),
  availability: z.literal("not_checked"),
}).strict();

// Original text is deliberately not trimmed, normalized, or interpreted as instructions.
export const EvidenceInputSchema = z.object({
  channel: z.enum(["web", "upload", "sms", "email"]),
  externalId: z.string().min(1).max(240),
  kind: z.enum(["public_link", "note", "document"]),
  label,
  url: EvidenceUrlSchema.nullable(),
  documentId: id.nullable(),
  fileName: label.nullable().default(null),
  originalText: z.string().max(64_000).nullable(),
  statementKind: z.enum(["human_quote", "publisher_claim", "model_inference"]),
  attributedTo: label,
  publishedAt: timestamp.nullable(),
  audience: z.enum(["private", "event"]),
}).strict().superRefine((value, ctx) => {
  if (value.kind === "public_link" && !value.url) ctx.addIssue({ code: "custom", message: "A link requires its original URL." });
  if (value.kind === "document" && !value.documentId && (!value.originalText || !value.fileName)) ctx.addIssue({ code: "custom", message: "A document requires an authorized original document record or the complete text and filename." });
  if (value.kind === "note" && !value.originalText) ctx.addIssue({ code: "custom", message: "A note requires original text." });
  if (value.documentId && (value.kind !== "document" || value.audience !== "private")) ctx.addIssue({ code: "custom", message: "Original confirmation documents stay private." });
});
export const IntakeEvidenceCommandSchema = z.object({ commandId: id, source: EvidenceInputSchema, indicativePrice: IndicativePriceSchema.nullable().default(null) }).strict();
export const EvidenceRecordSchema = z.object({
  id, eventId: id, suppliedByPersonId: id,
  source: EvidenceInputSchema,
  indicativePrice: IndicativePriceSchema.nullable().default(null),
  normalizedUrl: EvidenceUrlSchema.nullable(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  receivedAt: timestamp,
  trust: z.literal("untrusted_data"),
}).strict();

export const InventoryRequestSchema = z.object({
  provider: label.nullable(),
  target: z.object({ kind: z.enum(["property", "activity", "transport", "other"]), key: label, name: label }).strict(),
  startsOn: z.string().date().nullable(),
  endsOn: z.string().date().nullable(),
  startLocalTime: localTime.nullable(),
  endLocalTime: localTime.nullable(),
  timezone: timezone.nullable(),
  party: z.object({
    // Stable event-local identities invalidate applicability even when headcount is unchanged.
    participantIds: z.array(id).max(100),
    adults: z.number().int().nonnegative().max(100).nullable(),
    childAges: z.array(z.number().int().min(0).max(17).nullable()).max(100).nullable(),
    units: z.number().int().min(1).max(100).nullable(),
  }).strict(),
  duration: z.object({ amount: z.number().positive().max(10000), unit: z.enum(["minutes", "hours", "nights", "days"]) }).strict().nullable(),
  essentialComponents: z.array(label).max(30),
  dependencies: z.array(z.object({ componentId: label, version: z.number().int().positive() }).strict()).max(30),
}).strict().superRefine((value, ctx) => {
  if (value.startsOn && value.endsOn && value.endsOn < value.startsOn) ctx.addIssue({ code: "custom", message: "End date precedes start date." });
  if (new Set(value.dependencies.map(item => item.componentId)).size !== value.dependencies.length) ctx.addIssue({ code: "custom", message: "Duplicate dependencies." });
  if (new Set(value.party.participantIds).size !== value.party.participantIds.length) ctx.addIssue({ code: "custom", message: "Duplicate participants." });
});

export const InventoryCheckSelectionSchema = z.object({
  purpose: z.enum(["promising_candidate", "shortlist", "external_booking_handoff"]),
  // Chosen by Commons scheduling policy for this use. Never supplied by a model or hard-coded globally.
  maxAgeMs: z.number().int().min(1).max(30 * 24 * 60 * 60_000),
}).strict();

export const InventoryProviderOutputSchema = z.object({
  // Provider must echo what it actually checked, not the worker's request by default.
  checkedRequest: InventoryRequestSchema,
  availability: z.enum(["available", "unavailable", "request_only", "blocked", "unknown"]),
  bookingMechanism: z.enum(["instant", "request_to_book", "external_contact", "unknown"]),
  price: InventoryPriceSchema,
  restrictions: z.object({
    minimumNights: z.number().int().positive().nullable(),
    maximumParty: z.number().int().positive().nullable(),
    minimumAge: z.number().int().min(0).max(120).nullable(),
    notes: z.array(label).max(20),
  }).strict(),
  checkedAt: timestamp,
  validUntil: timestamp.nullable(),
  capture: z.object({
    sourceUrl: EvidenceUrlSchema.nullable(),
    originalText: z.string().min(1).max(64_000),
    kind: z.enum(["inventory_response", "publisher_page", "search_snippet", "human_statement", "model_narrative"]),
  }).strict(),
  reportedCost: z.object({ amount: z.string().regex(/^\d+(\.\d+)?$/), currency: z.string().regex(/^[A-Z]{3}$/) }).strict().nullable().default(null),
}).strict().refine(value => !value.validUntil || Date.parse(value.validUntil) > Date.parse(value.checkedAt), "Expiry must follow the observation.");

export const ExtractionOutputSchema = z.object({
  claims: z.array(z.object({
    field: z.enum(["availability", "price", "restriction", "context"]),
    value: z.string().min(1).max(1000),
    // An exact substring of the original capture; inference stays inference even with a quote.
    quote: z.string().min(1).max(2000),
  }).strict()).max(30),
}).strict();

export const VerificationFailureSchema = z.enum([
  "provider_timeout", "provider_failed", "malformed_provider_output", "malformed_model_output",
  "model_timeout", "model_failed", "source_access_denied", "provider_unavailable", "attempts_exhausted",
]);
export const VerificationTraceSchema = z.object({
  providerId: label, providerVersion: label,
  mode: z.enum(["fixture", "public_research", "direct_inventory"]),
  model: z.object({ providerId: label, modelId: label, version: label }).strict().nullable(),
  startedAt: timestamp, finishedAt: timestamp,
}).strict();
export const InventoryObservationSchema = z.object({
  evidenceId: id,
  request: InventoryRequestSchema,
  output: InventoryProviderOutputSchema,
  trace: VerificationTraceSchema,
  extraction: ExtractionOutputSchema.nullable(),
  extractionKind: z.literal("model_inference"),
  approval: z.literal("not_requested"),
}).strict();
export const QueueInventoryCheckCommandSchema = z.object({
  commandId: id, evidenceId: id, request: InventoryRequestSchema,
  providerId: label,
  selection: InventoryCheckSelectionSchema,
}).strict();

export type EvidenceInput = z.infer<typeof EvidenceInputSchema>;
export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>;
export type InventoryRequest = z.infer<typeof InventoryRequestSchema>;
export type InventoryPrice = z.infer<typeof InventoryPriceSchema>;
export type InventoryProviderOutput = z.infer<typeof InventoryProviderOutputSchema>;
export type ExtractionOutput = z.infer<typeof ExtractionOutputSchema>;
export type VerificationTrace = z.infer<typeof VerificationTraceSchema>;
export type VerificationFailure = z.infer<typeof VerificationFailureSchema>;
export type InventoryObservation = z.infer<typeof InventoryObservationSchema>;
export type IndicativePrice = z.infer<typeof IndicativePriceSchema>;
export type InventoryCheckSelection = z.infer<typeof InventoryCheckSelectionSchema>;

// Server-configured adapters only. No credentials, database handles, commands, or tools in input.
export interface VerificationProvider {
  id: string;
  version: string;
  mode: VerificationTrace["mode"];
  verify(input: { request: InventoryRequest; evidence: EvidenceRecord; signal: AbortSignal }): Promise<unknown>;
}
export interface EvidenceExtractor {
  providerId: string;
  modelId: string;
  version: string;
  extract(input: { untrustedText: string; signal: AbortSignal }): Promise<unknown>;
}
