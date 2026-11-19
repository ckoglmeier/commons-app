import { CoordinatorTurnError } from "./coordinator-errors";
import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { ItineraryActionSchema, ItineraryDraftSchema, validateItineraryContent, itineraryPlanFields, planFieldChanges, chosenShortlistOption, invalidateImportedItineraryContent, itineraryParticipantDraft, ItineraryDocumentRevisionSchema, undoItineraryRevision, type ItineraryDraft, type ItineraryDocumentRevision } from "@commons/contracts";
import { createDatabase } from "./client";
import { commons, memberships, coordinatorThreads, coordinatorTurns, processedCommands, auditEvents, pollDrafts } from "./schema";
import { loadSavedItineraryAnchors } from "./itinerary-anchors";
import { CommandAccessError, CommandConflictError, runEventCommand, type CommandTransaction } from "./event-command";
import { isCommonsId } from "./commons-identifier";
import type { PollRepositoryOptions } from "./poll-repository";
import { addCommonsItineraryItemInTransaction, upsertCommonsTravelPlanInTransaction, reviseItineraryItemFieldsInTransaction, readItineraryItemForReviewInTransaction, CommonsRepositoryError } from "./pilot-repository";
import { saveTripTaskInTransaction } from "./trip-task-repository";
import { assertGoalProposalCurrent } from "./coordinator-goal-repository";
import { saveCommonsPollDraftInTransaction } from "./poll-draft-repository";

export function itineraryDigest(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function commandId(seed: string, id: string) { const h = itineraryDigest([seed, id]); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`; }

/** Narrow saved-fact allowlist. No cost, contact, booking reference or private travel. */
export async function itineraryFacts(tx: CommandTransaction, event: string) {
  const [trip] = await tx.select().from(commons).where(eq(commons.id, event));
  if (!trip) throw new CommandAccessError();
  const anchors = await loadSavedItineraryAnchors(tx, trip);
  if (!anchors.complete) throw new CommandConflictError();
  return { facts: anchors.facts, factsFingerprint: anchors.factsFingerprint };
}
export async function latestItinerary(tx: CommandTransaction, event: string, threadId: string) {
  const [row] = await tx.select().from(coordinatorTurns).where(and(eq(coordinatorTurns.commonsId, event), eq(coordinatorTurns.threadId, threadId),
    eq(coordinatorTurns.organizerShared, true), sql`${coordinatorTurns.workspace}->'itineraryDraft' is not null`,
    sql`coalesce(${coordinatorTurns.workspace}->'lifecycle'->>'status', 'completed') = 'completed'`)).orderBy(desc(coordinatorTurns.sequence)).limit(1);
  return row ? { turnId: row.id, draft: ItineraryDraftSchema.parse(row.workspace?.itineraryDraft) } : null;
}
export async function itineraryContext(identifier: string, threadId: string, options: PollRepositoryOptions) {
  const db = createDatabase(options.databaseUrl);
  try { return await db.db.transaction(async tx => {
    const [trip] = await tx.select().from(commons).where(isCommonsId(identifier) ? eq(commons.id, identifier) : eq(commons.slug, identifier));
    const [member] = trip ? await tx.select().from(memberships).where(and(eq(memberships.commonsId, trip.id), eq(memberships.personId, options.actorPersonId), eq(memberships.status, "active"), eq(memberships.role, "organizer"))) : [];
    const [thread] = trip ? await tx.select().from(coordinatorThreads).where(and(eq(coordinatorThreads.commonsId, trip.id), eq(coordinatorThreads.id, threadId))) : [];
    if (!member || !thread) throw new CommandAccessError();
    return { ...await itineraryFacts(tx, trip.id), previous: (await latestItinerary(tx, trip.id, threadId))?.draft ?? null, actorId: options.actorPersonId };
  }); } finally { await db.close(); }
}

/** Organizer-only: the turn that currently holds this thread's document, for commands that must name it. */
export async function itineraryDocumentTurn(identifier: string, threadId: string, options: PollRepositoryOptions) {
  const db = createDatabase(options.databaseUrl);
  try { return await db.db.transaction(async tx => {
    const [trip] = await tx.select().from(commons).where(isCommonsId(identifier) ? eq(commons.id, identifier) : eq(commons.slug, identifier));
    const [member] = trip ? await tx.select().from(memberships).where(and(eq(memberships.commonsId, trip.id), eq(memberships.personId, options.actorPersonId), eq(memberships.status, "active"), eq(memberships.role, "organizer"))) : [];
    if (!member) throw new CommandAccessError();
    const latest = await latestItinerary(tx, trip.id, threadId);
    return latest ? { turnId: latest.turnId, documentId: latest.draft.id, version: latest.draft.version } : null;
  }); } finally { await db.close(); }
}

/** Add durable private identity to old projections before their turn reference changes. No participant snapshot changes. */
async function pinProjectionIdentity(tx: CommandTransaction, event: string, draft: ItineraryDraft) {
  if (!draft.sharingDraft) return;
  const [projection] = await tx.select().from(pollDrafts).where(and(eq(pollDrafts.commonsId, event), eq(pollDrafts.id, draft.sharingDraft.draftId))).for("update");
  if (!projection) throw new CommandConflictError();
  if (projection.data.privateItineraryDocument && projection.data.privateItineraryDocument.id !== draft.id) throw new CommandConflictError();
  if (!projection.data.privateItineraryDocument) await tx.update(pollDrafts).set({ data: { ...projection.data, privateItineraryDocument: { id: draft.id, version: draft.version } } }).where(eq(pollDrafts.id, projection.id));
}

/** Runs under the existing coordinator event lock. All selected commands commit together. */
export async function actOnItinerary(tx: CommandTransaction, event: string, raw: unknown, options: PollRepositoryOptions) {
  const input = ItineraryActionSchema.parse(raw);
  return runEventCommand(tx, { identifier: event, actorPersonId: options.actorPersonId, commandId: input.commandId, action: "research_itinerary.reviewed", input },
    async ({ role }) => { if (role !== "organizer") throw new CommandAccessError(); }, async ({ now }) => {
      const latest = await latestItinerary(tx, event, input.threadId);
      if (!latest || latest.turnId !== input.turnId || latest.draft.version !== input.expectedVersion) throw new CommandConflictError();
      const draft = structuredClone(latest.draft);
      const pilotContent = (content: ItineraryDraft["content"]) => content.items.some(item => item.partySize != null || item.decision?.shortlist != null || item.decision?.chosenOptionId != null) || (content.questions ?? []).some(question => question.resolved !== undefined);
      // Check under the existing event lock, including saved documents and forged requests.
      // Legacy itinerary edits and sharing remain available outside this pilot.
      if (options.activityDecisionsEnabled === false && (["apply", "update_plan", "link_existing"].includes(input.operation) || pilotContent(draft.content) || input.content && pilotContent(input.content))) throw new CoordinatorTurnError("unsupported_capability");
      await pinProjectionIdentity(tx, event, latest.draft);
      if (input.operation === "remove_import") {
        if (!input.importId || !draft.imports.some(item => item.id === input.importId)) throw new CommandConflictError();
        draft.imports = draft.imports.map(item => item.id === input.importId ? { ...item, active: false } : item);
        draft.content = invalidateImportedItineraryContent(draft);
        draft.sharingDraft = undefined;
        const references = new Set(draft.content.items.flatMap(item => [...item.sources, ...(item.decision?.shortlist ?? []).flatMap(option => option.sources)].map(source => `${source.runId}:${source.sourceId}`)));
        draft.evidence = draft.evidence.filter(source => references.has(`${source.runId}:${source.sourceId}`));
      } else if (input.operation === "revise") {
        if (!input.content) throw new CommandConflictError();
        draft.content = validateItineraryContent(input.content, draft, { privateDocumentEdit: true });
        draft.sharingDraft = undefined;
      } else if (input.operation === "undo") {
        const [stored] = input.revisionCommandId ? await tx.select().from(processedCommands).where(and(eq(processedCommands.commonsId, event), eq(processedCommands.commandId, input.revisionCommandId))) : [];
        const revision = ItineraryDocumentRevisionSchema.safeParse((stored?.result?.result as { revision?: unknown } | undefined)?.revision);
        if (!revision.success || revision.data.documentId !== draft.id || revision.data.threadId !== draft.threadId || !revision.data.before || !revision.data.undoable || revision.data.contextDigest !== importContextDigest(draft)) throw new CommandConflictError();
        const before = revision.data.before;
        let after = revision.data.after;
        if (input.undoItemId) {
          if (!before.items.some(item => item.id === input.undoItemId) || after.items.some(item => item.id === input.undoItemId)) throw new CommandConflictError();
          // Deletion Undo reverses that row only, even if its autosave included other edits.
          after = { ...before, items: before.items.filter(item => item.id !== input.undoItemId) };
        }
        try { draft.content = validateItineraryContent(undoItineraryRevision(draft.content, before, after), draft, { privateDocumentEdit: true }); } catch { throw new CommandConflictError(); }
        draft.sharingDraft = undefined;
      } else if (input.operation === "prepare_poll") {
        // Only the current approved fact basis can prepare a participant version.
        await assertGoalProposalCurrent(tx, event, input.turnId);
        if ((await itineraryFacts(tx, event)).factsFingerprint !== draft.factsFingerprint) throw new CommandConflictError();
        const projected = itineraryParticipantDraft(draft.content, key => commandId(draft.id, `public:${key}`), draft.evidence);
        const data = { ...projected, privateItineraryDocument: { id: draft.id, version: draft.version } };
        const contentDigest = itineraryDigest(projected);
        if (draft.sharingDraft?.contentDigest !== contentDigest) {
          const id = commandId(draft.id, `sharing:${contentDigest}`);
          await saveCommonsPollDraftInTransaction(tx, event, { id, commandId: commandId(id, "prepare"), expectedVersion: 0, data }, options, { threadId: input.threadId });
          draft.sharingDraft = { contentDigest, draftId: id };
        }
      } else if (input.operation === "link_existing") {
        // Identity binding: the saved record is named by id and its reviewed version, never matched by title.
        if (!input.planItemId || !input.expectedRecordVersion || draft.receipts.some(receipt => receipt.savedId === input.planItemId) || draft.content.items.length >= 30) throw new CommandConflictError();
        const record = await readItineraryItemForReviewInTransaction(tx, event, input.planItemId);
        // Person-specific records ("Just me"/specific people) are not brought into a group document.
        if (!record || record.status === "cancelled" || record.audience === "subgroup" || record.version !== input.expectedRecordVersion) throw new CommandConflictError();
        const candidateId = `plan-${record.id}`;
        if (draft.content.items.some(item => item.id === candidateId)) throw new CommandConflictError();
        const end = record.time && record.durationMinutes ? Number(record.time.slice(0, 2)) * 60 + Number(record.time.slice(3)) + record.durationMinutes : null;
        draft.content = { ...draft.content, items: [...draft.content.items, { id: candidateId, kind: record.mealType ? "meal" : "activity", title: record.title.slice(0, 120),
          day: record.date, time: record.time, endTime: end !== null && end < 24 * 60 ? `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}` : null,
          location: (record.location ?? "").slice(0, 160), note: "", participantNote: null, venue: null, participation: record.audience === "individual" ? "optional" : "group",
          alternative: false, evidence: "organizer_preference", sources: [], unresolved: [], decision: null }] };
        try { draft.content = validateItineraryContent(draft.content, draft, { privateDocumentEdit: true }); } catch { throw new CommandConflictError(); }
        draft.receipts.push({ candidateId, kind: "plan", savedId: record.id, commandId: input.commandId, linked: true });
        draft.sharingDraft = undefined;
      } else if (input.operation === "update_plan") {
        await assertGoalProposalCurrent(tx, event, input.turnId);
        if ((await itineraryFacts(tx, event)).factsFingerprint !== draft.factsFingerprint) throw new CommandConflictError();
        const updates = input.planUpdates ?? [];
        if (!updates.length || new Set(updates.map(row => row.candidateId)).size !== updates.length) throw new CommandConflictError();
        const [trip] = await tx.select().from(commons).where(eq(commons.id, event));
        for (const update of updates) {
          const receipt = draft.receipts.find(row => row.candidateId === update.candidateId && row.kind === "plan");
          const item = draft.content.items.find(row => row.id === update.candidateId);
          if (!receipt || receipt.savedId !== update.savedId || !item || item.decision && !chosenShortlistOption(item)) throw new CommandConflictError();
          const record = await readItineraryItemForReviewInTransaction(tx, event, receipt.savedId);
          if (!record || record.version !== update.expectedRecordVersion) throw new CommandConflictError();
          const changes = planFieldChanges(itineraryPlanFields(item, draft.evidence), record);
          // The reviewed field list must be exactly what would change now.
          if (JSON.stringify(changes.map(change => change.field).sort()) !== JSON.stringify([...update.fields].sort())) throw new CommandConflictError();
          const proposed = itineraryPlanFields(item, draft.evidence), operationId = commandId(input.commandId, update.candidateId);
          const fields = Object.fromEntries(changes.map(change => [change.field === "duration" ? "durationMinutes" : change.field, change.field === "duration" ? proposed.durationMinutes : proposed[change.field as "title" | "date" | "time" | "location" | "sourceUrl"]]));
          let saved;
          try { saved = await reviseItineraryItemFieldsInTransaction(tx, trip, { commandId: operationId, itemId: record.id, expectedVersion: update.expectedRecordVersion, occurredAt: now.toISOString(), fields }, options); }
          catch (error) { if (error instanceof CommonsRepositoryError) throw new CommandConflictError(); throw error; }
          if (saved.replayed) throw new CommandConflictError();
          draft.planUpdates = [...(draft.planUpdates ?? []), { candidateId: item.id, savedId: record.id, commandId: operationId, fromVersion: record.version, toVersion: saved.version, fields: update.fields, draftVersion: draft.version + 1 }];
        }
        const refreshed = await itineraryFacts(tx, event);
        draft.facts = refreshed.facts;
        draft.factsFingerprint = refreshed.factsFingerprint;
      } else {
        await assertGoalProposalCurrent(tx, event, input.turnId);
        if ((await itineraryFacts(tx, event)).factsFingerprint !== draft.factsFingerprint) throw new CommandConflictError();
        const selected = new Set(input.selectedIds ?? []), taskIds = new Set(input.taskIds ?? []);
        if (!selected.size && !taskIds.size || [...selected].some(id => !draft.content.items.some(item => item.id === id && item.kind !== "downtime" && !item.travelAnchor)) || [...taskIds].some(id => !draft.content.tasks.some(item => item.id === id))) throw new CommandConflictError();
        const owners = new Map((input.taskOwners ?? []).map(owner => [owner.taskId, owner.ownerPersonId]));
        // Every task needs an explicitly chosen owner; preferences never assign work.
        if (owners.size !== (input.taskOwners ?? []).length || [...owners.keys()].some(id => !taskIds.has(id)) || [...taskIds].some(id => !owners.has(id))) throw new CommandConflictError();
        // An open decision is saved only after the organizer chooses an option.
        if (draft.content.items.some(item => selected.has(item.id) && item.decision && !chosenShortlistOption(item))) throw new CommandConflictError();
        const [trip] = await tx.select().from(commons).where(eq(commons.id, event));
        for (const item of draft.content.items.filter(item => selected.has(item.id))) {
          if (draft.receipts.some(receipt => receipt.candidateId === item.id)) continue;
          const operationId = commandId(draft.id, item.id);
          let kind: "plan" | "travel";
          // Notes and imported commentary stay organizer-only. The saved item's
          // minimal provenance is reviewed here and never claims a reservation.
          if (item.kind === "transport") {
            if (!item.day) throw new CommandConflictError();
            kind = "travel";
            await upsertCommonsTravelPlanInTransaction(tx, trip, trip.slug, { commandId: operationId, kind: "transport", date: item.day, time: item.time,
              route: item.title, status: "considering", note: "Organizer-reviewed research draft; not booked.", companionPersonId: null, includedPersonIds: [options.actorPersonId] }, options);
          } else {
            kind = "plan";
            const fields = itineraryPlanFields(item, draft.evidence), chosen = chosenShortlistOption(item);
            await addCommonsItineraryItemInTransaction(tx, trip, trip.slug, { commandId: operationId, title: fields.title, date: fields.date, time: fields.time, location: fields.location ?? "",
              durationMinutes: fields.durationMinutes,
              status: item.day ? "planned" : "idea", participantScope: item.participation === "optional" ? "optional" : "everyone", expectedParticipantIds: [],
              // A meal with a named place is a restaurant meal; an unnamed meal stays a generic activity rather than guessing.
              ...(item.kind === "meal" && (item.venue || chosen) ? { mealType: "restaurant" } : {}),
              note: chosen ? "Organizer-chosen option; not booked. Attendance is undecided." : "Organizer-reviewed research draft; not booked. Attendance is undecided.", sourceUrl: fields.sourceUrl,
              occurredAt: now.toISOString() }, options);
          }
          const [receipt] = await tx.select().from(processedCommands).where(and(eq(processedCommands.commonsId, event), eq(processedCommands.commandId, operationId)));
          const savedId = (receipt.result as { itineraryItemId?: string; travelPlanId?: string })[kind === "plan" ? "itineraryItemId" : "travelPlanId"];
          if (!savedId) throw new CommandConflictError();
          draft.receipts.push({ candidateId: item.id, kind, savedId, commandId: operationId });
        }
        for (const task of draft.content.tasks.filter(task => taskIds.has(task.id))) {
          if (draft.receipts.some(receipt => receipt.candidateId === task.id)) continue;
          // Same linked item and title as an already saved task: reuse it rather than create a second.
          const same = draft.receipts.find(receipt => receipt.kind === "task" && draft.content.tasks.some(row => row.id === receipt.candidateId && row.itemId === task.itemId && row.title.trim().toLowerCase() === task.title.trim().toLowerCase()));
          if (same) { draft.receipts.push({ candidateId: task.id, kind: "task", savedId: same.savedId, commandId: same.commandId }); continue; }
          const link = draft.receipts.find(receipt => receipt.candidateId === task.itemId && receipt.kind !== "task");
          if (task.itemId && !link) throw new CommandConflictError();
          const operationId = commandId(draft.id, task.id), savedId = commandId(draft.id, `task:${task.id}`);
          await saveTripTaskInTransaction(tx, event, { commandId: operationId, id: savedId, expectedVersion: 0, title: task.title, ownerPersonId: owners.get(task.id) ?? options.actorPersonId,
            dueOn: null, completed: false, itemKind: link?.kind ?? null, itemId: link?.savedId ?? null }, options);
          draft.receipts.push({ candidateId: task.id, kind: "task", savedId, commandId: operationId });
        }
        // These approved additions changed the fact basis themselves. Keep later
        // selections usable while still rejecting changes from another writer.
        const refreshed = await itineraryFacts(tx, event);
        draft.facts = refreshed.facts;
        draft.factsFingerprint = refreshed.factsFingerprint;
      }
      // Undo can restore an older structured shortlist; fail before committing it too.
      if (options.activityDecisionsEnabled === false && pilotContent(draft.content)) throw new CoordinatorTurnError("unsupported_capability");
      draft.version++;
      const [turn] = await tx.select().from(coordinatorTurns).where(eq(coordinatorTurns.id, input.turnId));
      await tx.update(coordinatorTurns).set({ workspace: { ...turn.workspace, itineraryDraft: ItineraryDraftSchema.parse(draft) } }).where(eq(coordinatorTurns.id, input.turnId));
      const revision = documentRevision(input.commandId, latest.draft, draft, options.actorPersonId, input.operation === "undo" ? "undo" : "human", now, input.operation === "revise" || input.operation === "undo");
      return { result: { documentId: draft.id, version: draft.version, receipts: draft.receipts, planUpdates: draft.planUpdates ?? [], revision }, resourceType: "research_itinerary", resourceId: draft.id, summary: input.operation === "apply" ? "Saved selected research items after organizer approval." : input.operation === "update_plan" ? "Updated saved Plan activities after organizer approval." : input.operation === "link_existing" ? "Linked a saved Plan activity into the itinerary draft." : "Updated organizer-only itinerary draft." };
    });
}

function importContextDigest(draft: ItineraryDraft) { return itineraryDigest(draft.imports.map(row => ({ id: row.id, digest: row.digest, active: row.active })).sort((a, b) => a.id.localeCompare(b.id))); }
function documentRevision(command: string, before: ItineraryDraft | null, after: ItineraryDraft, actorId: string, source: ItineraryDocumentRevision["source"], now: Date, undoable = true) {
  return ItineraryDocumentRevisionSchema.parse({ commandId: command, documentId: after.id, threadId: after.threadId, version: after.version,
    actorId, source, undoable, contextDigest: importContextDigest(after), at: now.toISOString(), before: before?.content ?? null, after: after.content });
}
/** Chat commits record history in the same transaction as their successful turn. */
export async function recordCoordinatorItineraryRevision(tx: CommandTransaction, event: string, command: string, before: ItineraryDraft | null, after: ItineraryDraft, options: PollRepositoryOptions) {
  if (before) await pinProjectionIdentity(tx, event, before);
  const id = commandId(command, "itinerary-document-revision");
  return runEventCommand(tx, { identifier: event, actorPersonId: options.actorPersonId, commandId: id, action: "research_itinerary.chat_revision", input: { documentId: after.id, version: after.version } },
    ({ role }) => { if (role !== "organizer") throw new CommandAccessError(); }, async ({ now }) => ({
      result: { revision: documentRevision(id, before, after, options.actorPersonId, "coordinator", now) },
      resourceType: "research_itinerary", resourceId: after.id, summary: "Saved a conversational itinerary document revision.",
    }));
}
export async function readItineraryDocumentRevisions(identifier: string, threadId: string, documentId: string, options: PollRepositoryOptions) {
  const db = createDatabase(options.databaseUrl);
  try { return await db.db.transaction(async tx => {
    const [trip] = await tx.select().from(commons).where(isCommonsId(identifier) ? eq(commons.id, identifier) : eq(commons.slug, identifier));
    const [member] = trip ? await tx.select().from(memberships).where(and(eq(memberships.commonsId, trip.id), eq(memberships.personId, options.actorPersonId), eq(memberships.status, "active"), eq(memberships.role, "organizer"))) : [];
    const latest = member ? await latestItinerary(tx, trip.id, threadId) : null;
    if (!latest || latest.draft.id !== documentId) throw new CommandAccessError();
    const rows = await tx.select({ receipt: processedCommands.result }).from(auditEvents).innerJoin(processedCommands,
      and(eq(processedCommands.commonsId, auditEvents.commonsId), eq(processedCommands.commandId, auditEvents.commandId)))
      .where(and(eq(auditEvents.commonsId, trip.id), eq(auditEvents.resourceType, "research_itinerary"), eq(auditEvents.resourceId, documentId)))
      .orderBy(desc(auditEvents.occurredAt)).limit(50);
    return rows.flatMap(row => { const parsed = ItineraryDocumentRevisionSchema.safeParse((row.receipt.result as { revision?: unknown } | undefined)?.revision);
      return parsed.success && parsed.data.threadId === threadId ? [parsed.data] : []; });
  }); } finally { await db.close(); }
}
