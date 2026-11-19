import "server-only";
import { createHash } from "node:crypto";
import { ItineraryContentSchema, ItineraryImportApplySchema, ItineraryImportChangeSchema, ItineraryImportPreviewRequestSchema, ItineraryImportPreviewSchema, ItineraryImportReceiptSchema,
  type ItineraryContent, type ItineraryImportPreview, type ItineraryImportReceipt } from "@commons/contracts";
import { CommandAccessError, createImportedItineraryDocument, itineraryContext, itineraryDocumentTurn, readItineraryDocumentRevisions, resolveCommonsTripId } from "@commons/database";
import { applyItineraryImportPlan, itineraryExportFilename, itineraryMarkdown, parseItineraryImport, planItineraryImport, ItineraryImportError, type ItineraryImportPlan } from "../itinerary-portability";
import { actOnAuthenticatedCoordinatorWorkspace, authenticatedGoalOptions, coordinatorWorkspaceEnabled } from "./polls";
import { readCommonsRuntimeEnvironment } from "./runtime-environment";
import { recipesAvailableFor } from "./recipe-access";

/*
 * Shared service contract for itinerary portability: read/export, import preview and apply.
 * The Coordinator routes call it today; a future MCP adapter should call the same functions rather than
 * re-implementing matching. Authorization is the existing organizer check in each repository call, and
 * every write goes through an existing versioned command. Import text is data: nothing here calls a model,
 * fetches a link or follows instructions found in a file.
 */

export class ItineraryPortabilityError extends Error { constructor(message: string, readonly status: number) { super(message); } }
const EMPTY: ItineraryContent = ItineraryContentSchema.parse({ title: "Trip itinerary", brief: "", items: [], tasks: [], driverBrief: "", unresolved: [] });
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

/** Default off. It also needs the Coordinator itinerary document workflow it extends. */
export function itineraryPortabilityEnabled(environment: { [name: string]: unknown } = readCommonsRuntimeEnvironment()) {
  return environment.COMMONS_ASSISTANT_UI_ENABLED === "true" && environment.COMMONS_ITINERARY_PORTABILITY_ENABLED === "true";
}
/** Pilot never inherits the global recipe switch: require the verified account AND allowed trip. */
export async function itineraryPortabilityAvailableFor(slug: string, environment = readCommonsRuntimeEnvironment()) {
  if (itineraryPortabilityEnabled(environment)) return true;
  return environment.COMMONS_ASSISTANT_UI_ENABLED === "true"
    && environment.COMMONS_ITINERARY_PORTABILITY_PILOT_ENABLED === "true"
    && await recipesAvailableFor(slug, { ...environment, COMMONS_RECIPES_ENABLED: "false" });
}
async function context(slug: string, threadId: string) {
  if (!await itineraryPortabilityAvailableFor(slug) || !await coordinatorWorkspaceEnabled(slug)) throw new ItineraryPortabilityError("Itinerary import and export aren’t available here.", 404);
  const options = await authenticatedGoalOptions(slug);
  const [context, turn] = await Promise.all([itineraryContext(slug, threadId, options), itineraryDocumentTurn(slug, threadId, options)]);
  const saved = { ...context, previousTurnId: turn?.turnId ?? null };
  return { options, saved, tripId: await resolveCommonsTripId(slug, options.databaseUrl) };
}

export async function exportAuthenticatedItinerary(slug: string, threadId: string, documentId: string) {
  const { saved, tripId } = await context(slug, threadId);
  if (!saved.previous || saved.previous.id !== documentId || !tripId) throw new CommandAccessError();
  const draft = saved.previous;
  return { filename: itineraryExportFilename(draft.content.title, draft.version), version: draft.version,
    markdown: itineraryMarkdown(draft.content, { tripId, threadId, documentId: draft.id, version: draft.version, exportedAt: new Date().toISOString() }) };
}

type Prepared = { preview: ItineraryImportPreview; plan: ItineraryImportPlan; current: ItineraryContent; turnId: string | null; digest: string };
async function prepare(slug: string, threadId: string, text: string): Promise<Prepared & Awaited<ReturnType<typeof context>>> {
  const loaded = await context(slug, threadId), { saved, tripId, options } = loaded, current = saved.previous;
  let parsed;
  try { parsed = parseItineraryImport(text); } catch (error) { if (error instanceof ItineraryImportError) throw new ItineraryPortabilityError(error.message, 400); throw error; }
  const digest = sha(text), seed = current?.id ?? threadId;
  const newId = (key: string) => `imp-${sha(`${seed}:${digest}:${key}`).slice(0, 24)}`;
  const shell = { threadId, documentId: current?.id ?? null, currentVersion: current?.version ?? 0, title: current?.content.title ?? parsed.title?.slice(0, 200) ?? "Trip itinerary", kept: [], unrecognized: parsed.problems.slice(0, 100) };
  const rejected = (message: string): Prepared & typeof loaded => ({ ...loaded, preview: ItineraryImportPreviewSchema.parse({ ...shell, mode: "rejected", baseVersion: parsed.meta?.baseVersion ?? null, stale: false, changes: [], message }),
    plan: { changes: [], kept: [], unrecognized: [] }, current: current?.content ?? EMPTY, turnId: saved.previousTurnId, digest });
  if (parsed.metaError) return rejected(`${parsed.metaError} Nothing was changed. To add its stops as new ones instead, delete the Commons details block at the end and try again.`);
  let mode: "update" | "add" | "create", base: ItineraryContent, stale = false, message: string | null = null;
  if (parsed.meta) {
    if (!tripId || parsed.meta.tripId !== tripId.toLowerCase()) return rejected("This file was exported from a different trip, so it can’t change this one. Nothing was changed.");
    if (!current || parsed.meta.documentId !== current.id || parsed.meta.threadId !== threadId) return rejected("This file belongs to a different itinerary. Open the conversation it came from, or delete the Commons details block at the end to add its stops as new ones. Nothing was changed.");
    if (parsed.meta.baseVersion > current.version) return rejected("This file names a version this itinerary doesn’t have, so it can’t be matched. Nothing was changed.");
    if (parsed.meta.baseVersion === current.version) base = current.content;
    else {
      const revision = (await readItineraryDocumentRevisions(slug, threadId, current.id, options)).find(row => row.version === parsed.meta!.baseVersion);
      if (!revision) return rejected(`This file was exported from version ${parsed.meta.baseVersion}. The itinerary is now version ${current.version}, and the earlier version isn’t available to compare. Export a fresh copy and make your edits there. Nothing was changed.`);
      base = revision.after; stale = true;
      message = `Exported from version ${parsed.meta.baseVersion}; the itinerary is now version ${current.version}. Changes made in Commons since then are kept. Edits that overlap them can’t be applied.`;
    }
    mode = "update";
  } else if (current) {
    mode = "add"; base = current.content;
    message = "This file has no Commons details, so its stops are offered as additions. Nothing in your itinerary is replaced or removed.";
  } else {
    mode = "create"; base = EMPTY;
    message = "This creates a private itinerary for organizers. Nothing is shared, added to the trip or booked.";
  }
  const plan = planItineraryImport({ parsed, mode, base, current: current?.content ?? EMPTY, facts: { startsOn: saved.facts.startsOn, endsOn: saved.facts.endsOn }, newId });
  if (!plan.changes.length) message = [message, "There are no changes to apply."].filter(Boolean).join(" ");
  const preview = ItineraryImportPreviewSchema.parse({ ...shell, mode, baseVersion: parsed.meta?.baseVersion ?? null, stale, message,
    changes: plan.changes.map(change => ItineraryImportChangeSchema.parse(Object.fromEntries(Object.entries(change).filter(([key]) => key !== "operation")))), kept: plan.kept, unrecognized: plan.unrecognized });
  return { ...loaded, preview, plan, current: current?.content ?? EMPTY, turnId: saved.previousTurnId, digest };
}

export async function previewAuthenticatedItineraryImport(slug: string, raw: unknown): Promise<ItineraryImportPreview> {
  const input = ItineraryImportPreviewRequestSchema.parse(raw);
  return (await prepare(slug, input.threadId, input.text)).preview;
}

/** Recomputes the review from the submitted text and the saved state; the client's view of the changes is never trusted. */
export async function applyAuthenticatedItineraryImport(slug: string, raw: unknown): Promise<ItineraryImportReceipt> {
  const input = ItineraryImportApplySchema.parse(raw);
  const prepared = await prepare(slug, input.threadId, input.text), { preview, plan, saved, options } = prepared;
  const receipt = (value: ItineraryImportReceipt) => ItineraryImportReceiptSchema.parse(value);
  if (preview.currentVersion !== input.expectedVersion) {
    // A retry after a lost response: the version after the expected one was written by this exact command.
    const document = saved.previous;
    const revision = document && input.expectedVersion < document.version ? (await readItineraryDocumentRevisions(slug, input.threadId, document.id, options)).find(row => row.version === input.expectedVersion + 1 && row.commandId === input.commandId) : undefined;
    if (document && revision) return receipt({ threadId: input.threadId, documentId: document.id, version: revision.version, revisionCommandId: revision.undoable ? revision.commandId : null, applied: input.selected.length, replayed: true });
    throw new ItineraryPortabilityError("The itinerary changed while you were reviewing this import. Review it again; nothing was changed.", 409);
  }
  if (preview.mode === "rejected") throw new ItineraryPortabilityError(preview.message ?? "This file can’t be applied. Nothing was changed.", 409);
  const selected = new Set(input.selected);
  if ([...selected].some(id => !plan.changes.some(change => change.id === id && change.selectable))) throw new ItineraryPortabilityError("One of the chosen changes is no longer available. Review the import again; nothing was changed.", 409);
  let content: ItineraryContent;
  try { content = applyItineraryImportPlan(prepared.current, plan, selected); } catch (error) { if (error instanceof ItineraryImportError) throw new ItineraryPortabilityError(`${error.message} Nothing was changed.`, 400); throw error; }
  if (preview.mode === "create") {
    const created = await createImportedItineraryDocument(slug, { commandId: input.commandId, threadId: input.threadId, content, sourceDigest: prepared.digest }, options);
    return receipt({ threadId: created.threadId, documentId: created.documentId, version: created.version, revisionCommandId: null, applied: selected.size, replayed: false });
  }
  if (!prepared.turnId || !saved.previous) throw new CommandAccessError();
  const result = await actOnAuthenticatedCoordinatorWorkspace(slug, { action: "itinerary", operation: "revise", turnId: prepared.turnId, threadId: input.threadId, commandId: input.commandId,
    expectedVersion: saved.previous.version, content }) as { documentId: string; version: number; revision: { commandId: string } };
  return receipt({ threadId: input.threadId, documentId: result.documentId, version: result.version, revisionCommandId: result.revision.commandId, applied: selected.size, replayed: false });
}
