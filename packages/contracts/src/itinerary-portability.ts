import { z } from "zod";

/** Version of the readable Markdown export. Its metadata is a matching hint, never authority. */
export const ITINERARY_EXPORT_FORMAT = "commons-itinerary/1";
export const ITINERARY_IMPORT_TEXT_LIMIT = 30000;

export const ItineraryImportChangeSchema = z.object({
  /** Stable for one import text against one saved version; the apply request names these. */
  id: z.string().min(1).max(160),
  kind: z.enum(["add", "edit", "remove"]),
  target: z.enum(["title", "opening", "closing", "day", "item", "question"]),
  label: z.string().max(400),
  before: z.string().max(5000).nullable(),
  after: z.string().max(5000).nullable(),
  /** False for conflicts with newer Commons edits: shown, never applied. */
  selectable: z.boolean(),
  selected: z.boolean(),
  note: z.string().max(400).nullable(),
}).strict();
export type ItineraryImportChange = z.infer<typeof ItineraryImportChangeSchema>;

export const ItineraryImportPreviewSchema = z.object({
  /** update: a returned Commons export; add: ordinary Markdown into an existing itinerary; create: a new private itinerary; rejected: nothing can be applied. */
  mode: z.enum(["update", "add", "create", "rejected"]),
  threadId: z.string().uuid(),
  documentId: z.string().uuid().nullable(),
  baseVersion: z.number().int().nonnegative().nullable(),
  /** The saved version this review was compared with. Apply must name it. */
  currentVersion: z.number().int().nonnegative(),
  stale: z.boolean(),
  title: z.string().max(200),
  changes: z.array(ItineraryImportChangeSchema).max(200),
  /** Exported stops missing from the returned file. They stay; missing is not a deletion. */
  kept: z.array(z.string().max(300)).max(100),
  /** Text Commons could not place. Shown for review, never silently dropped or applied. */
  unrecognized: z.array(z.string().max(600)).max(100),
  message: z.string().max(600).nullable(),
}).strict();
export type ItineraryImportPreview = z.infer<typeof ItineraryImportPreviewSchema>;

export const ItineraryImportPreviewRequestSchema = z.object({
  threadId: z.string().uuid(),
  text: z.string().min(1).max(ITINERARY_IMPORT_TEXT_LIMIT).refine(text => Boolean(text.trim()), "Paste or choose an itinerary file."),
}).strict();

export const ItineraryImportApplySchema = ItineraryImportPreviewRequestSchema.extend({
  selected: z.array(z.string().min(1).max(160)).min(1).max(200),
  expectedVersion: z.number().int().nonnegative(),
  commandId: z.string().uuid(),
}).strict();
export type ItineraryImportApply = z.infer<typeof ItineraryImportApplySchema>;

export const ItineraryImportReceiptSchema = z.object({
  threadId: z.string().uuid(), documentId: z.string().uuid(), version: z.number().int().positive(),
  /** The existing document revision command; its Undo reverses this import only while nothing newer changed it. */
  revisionCommandId: z.string().uuid().nullable(),
  applied: z.number().int().nonnegative(), replayed: z.boolean(),
}).strict();
export type ItineraryImportReceipt = z.infer<typeof ItineraryImportReceiptSchema>;
