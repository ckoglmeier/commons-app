import { z } from "zod";
import { WorkflowKeySchema, WorkflowReferenceSchema } from "./workflows";
import { ItineraryPollSnapshotSchema } from "./itinerary-poll";
import type { PollWorkingData } from "./poll";
import { ShortlistOptionSchema, shortlistError, participantOptionDetails, sourceBasis, qualifyOption, decisionScopeFor, type ShortlistOption } from "./activity-shortlist";

const sourceRef = z.object({ runId: z.string().uuid(), sourceId: z.string().max(40) }).strict();
export const ItineraryCandidateSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), kind: z.enum(["activity", "meal", "transport", "downtime"]),
  title: z.string().trim().min(1).max(120), day: z.string().date().nullable(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  // Flight anchors are context, never a new ground-transport or Activity save.
  travelAnchor: z.enum(["arrival", "departure"]).nullable().optional(),
  decision: z.object({ question: z.string().trim().min(1).max(240), options: z.array(z.string().trim().min(1).max(160)).min(2).max(8),
    // Optional structured shortlist (stable option identity, evidence, human
    // selections and notes). Absent on earlier drafts and on model output.
    shortlist: z.array(ShortlistOptionSchema).max(8).nullable().optional(),
    // The organizer's private choice after reviewing answers; never inferred from votes.
    chosenOptionId: z.string().max(80).nullable().optional(),
  }).strict().nullable().optional(),
  // Decision scope for coverage checks; public facts only (party size, never names).
  partySize: z.number().int().min(1).max(100).nullable().optional(),
  location: z.string().max(160), note: z.string().max(2000),
  participantNote: z.string().max(1000).nullable().optional(),
  venue: z.string().max(160).nullable().optional(),
  participation: z.enum(["group", "optional"]), alternative: z.boolean(),
  evidence: z.enum(["organizer_preference", "saved_fact", "researched_claim", "suggestion"]),
  sources: z.array(sourceRef).max(5), unresolved: z.array(z.string().max(300)).max(8),
}).strict();
const itineraryDay = z.object({day:z.string().date(),description:z.string().max(1000),label:z.string().trim().min(1).max(100).nullable().optional()}).strict();
export const ItineraryContentSchema = z.object({
  title: z.string().trim().min(1).max(160), brief: z.string().max(1500),
  opening: z.string().max(1500).nullable().optional(),
  closing: z.string().max(1000).nullable().optional(),
  days: z.array(itineraryDay).max(30).nullable().optional(),
  questions: z.array(z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), prompt: z.string().trim().min(1).max(240), resolved: z.boolean().optional() }).strict()).max(3).nullable().optional(),
  items: z.array(ItineraryCandidateSchema).max(30),
  driverBrief: z.string().max(2000),
  tasks: z.array(z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), title: z.string().min(1).max(160), itemId: z.string().max(80).nullable() }).strict()).max(12),
  unresolved: z.array(z.string().max(300)).max(12),
}).strict();
/** Required nullable additions keep the provider's strict JSON schema valid,
 * while stored drafts from earlier releases can omit these fields. */
export const ItineraryProviderContentSchema = ItineraryContentSchema.extend({
  opening: ItineraryContentSchema.shape.opening.unwrap(),
  closing: ItineraryContentSchema.shape.closing.unwrap(),
  days: z.array(itineraryDay.extend({label:itineraryDay.shape.label.unwrap()})).max(30).nullable(),
  questions: z.array(z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), prompt: z.string().trim().min(1).max(240) }).strict()).max(3).nullable(),
  items: z.array(ItineraryCandidateSchema.omit({ partySize: true }).extend({
    endTime: ItineraryCandidateSchema.shape.endTime.unwrap(),
    travelAnchor: ItineraryCandidateSchema.shape.travelAnchor.unwrap(),
    decision: z.object({ question: z.string().trim().min(1).max(240), options: z.array(z.string().trim().min(1).max(160)).min(2).max(8) }).strict().nullable(),
    participantNote: ItineraryCandidateSchema.shape.participantNote.unwrap(),
    venue: ItineraryCandidateSchema.shape.venue.unwrap(),
  })).max(30),
});
export const ItineraryImportSchema = z.object({
  id: z.string().uuid(), digest: z.string().length(64), text: z.string().max(30000),
  addedBy: z.string().uuid(), active: z.boolean(),
}).strict();
export const ItineraryFactsSchema = z.object({ startsOn: z.string().date().nullable(), endsOn: z.string().date().nullable(), timezone: z.string(), hotels: z.array(z.string()).max(200), flights: z.array(z.string()).max(200) }).strict();
export const ItineraryEvidenceSchema = z.object({ runId: z.string().uuid(), sourceId: z.string().max(40), title: z.string().max(240), url: z.string().url().regex(/^https?:\/\//i), excerpt: z.string().max(5000), retrievedAt: z.string().datetime() }).strict();
/** Private model assessment, distinct from verbatim search evidence and human approval. */
export const PublicResearchAssessmentSchema = z.object({
  provider: z.literal("perplexity"), policyVersion: z.enum(["perplexity-sol-research-v1", "perplexity-sol-research-v2", "perplexity-sol-research-v3", "perplexity-sol-research-v4", "perplexity-sol-research-v5", "perplexity-sol-research-v6", "perplexity-sol-research-v7", "perplexity-sol-research-v8"]),
  requestedModel: z.literal("openai/gpt-6.1-sol"), observedModel: z.string().max(120).nullable(),
  query: z.string().trim().min(1).max(500), searchQueries: z.array(z.string().trim().min(1).max(500)).min(1).max(3).optional(), answer: z.string().trim().min(1).max(24000),
  sources: z.array(ItineraryEvidenceSchema.extend({ coverage: z.literal("snippet"), excerptTruncated: z.boolean(), providerResultIds: z.array(z.string().max(40)).max(15) })).min(1).max(15),
  citations: z.array(z.object({ sourceId: z.string().max(40) }).strict()).min(1).max(15),
  retrievedAt: z.string().datetime(), elapsedMs: z.number().nonnegative(),
  usage: z.object({ inputTokens: z.number().int().nonnegative().nullable(), outputTokens: z.number().int().nonnegative().nullable(),
    reportedCostUsd: z.number().nonnegative().nullable() }).strict(),
}).strict().superRefine((value, context) => {
  const ids = new Set(value.sources.map(source => source.sourceId));
  if (ids.size !== value.sources.length || new Set(value.sources.map(source => source.runId)).size !== 1
    || value.citations.some(ref => !ids.has(ref.sourceId))) context.addIssue({ code: "custom", message: "Assessment citations must reference unique captured sources in one run." });
});
export type PublicResearchAssessment = z.infer<typeof PublicResearchAssessmentSchema>;

export const ItineraryDraftSchema = z.object({
  workflow: WorkflowReferenceSchema.optional(),
  researchAssessment: PublicResearchAssessmentSchema.optional(),
  id: z.string().uuid(), version: z.number().int().positive(), threadId: z.string().uuid(),
  ownerId: z.string().uuid(), factsFingerprint: z.string().length(64),
  facts: ItineraryFactsSchema,
  // Recent display window only. Authoritative instructions are read from durable
  // organizer turns, not accumulated into every draft revision.
  imports: z.array(ItineraryImportSchema).max(8), corrections: z.array(z.string().max(30000)).max(30),
  // Dependency closure (30 candidates × 5 references), plus a 30-source discovery
  // window. The durable research archive is separate; this is not an archive cap.
  evidence: z.array(ItineraryEvidenceSchema).max(180),
  content: ItineraryContentSchema,
  receipts: z.array(z.object({ candidateId: z.string(), kind: z.enum(["plan", "travel", "task"]), savedId: z.string().uuid(), commandId: z.string().uuid(),
    // Existing canonical records linked into this document rather than created by it.
    linked: z.boolean().optional() }).strict()).max(50),
  // Approved field-level updates to records this document already saved or linked.
  planUpdates: z.array(z.object({ candidateId: z.string(), savedId: z.string().uuid(), commandId: z.string().uuid(),
    fromVersion: z.string().datetime(), toVersion: z.string().datetime(), fields: z.array(z.enum(["title", "date", "time", "duration", "location", "sourceUrl"])).min(1).max(6),
    draftVersion: z.number().int().positive() }).strict()).max(100).optional(),
  sharingDraft: z.object({ contentDigest: z.string().length(64), draftId: z.string().uuid() }).strict().optional(),
}).strict();
export type ItineraryDraft = z.infer<typeof ItineraryDraftSchema>;
export type ItineraryContent = z.infer<typeof ItineraryContentSchema>;

/** Feedback preparation never proposes execution work. Historical saved Tasks
 * retain their exact candidate identity/content for receipts and protected edits. */
export function itineraryFeedbackContent(content: ItineraryContent, previous: Pick<ItineraryDraft, "content" | "receipts">): ItineraryContent {
  const savedTaskIds = new Set(previous.receipts.filter(receipt => receipt.kind === "task").map(receipt => receipt.candidateId));
  return { ...content, tasks: previous.content.tasks.filter(task => savedTaskIds.has(task.id)) };
}

/** Participant-visible fields only. This same projection is reviewed in the new
 * draft flow and saved into the normal immutable itinerary poll lifecycle. */
export function itineraryParticipantDraft(content: ItineraryContent, id: (key: string) => string, evidence: Array<{ runId: string; sourceId: string; url: string }> = []): PollWorkingData {
  const opening = content.opening?.trim() || null;
  const clock = (time: string) => { const hour = Number(time.slice(0, 2)); return `${hour % 12 || 12}:${time.slice(3)} ${hour >= 12 ? "PM" : "AM"}`; };
  const chronological = [...new Set(content.items.flatMap(item => item.day ? [item.day] : []))].sort();
  const days = [...new Set([...(content.days ?? []).map(section=>section.day),...chronological])];
  const snapshot = ItineraryPollSnapshotSchema.parse({ title: content.title.slice(0,120), feedbackMode: "pieces", ...(content.closing != null ? {closing:content.closing} : {}), days: days.map(day => ({
    id: id(`day:${day}`), label: content.days?.find(section=>section.day===day)?.label ?? new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`)), description: content.days?.find(section => section.day === day)?.description ?? "",
    items: content.items.filter(item => item.day === day).map(item => ({ id: id(`item:${item.id}`), time: item.time ? `${clock(item.time)}${item.endTime ? `–${clock(item.endTime)}` : ""}` : "",
      title: `${item.title}${chosenShortlistOption(item) ? `: ${chosenShortlistOption(item)!.label}` : ""}${item.participation === "optional" && !/\boptional\b/i.test(item.title) ? " (optional)" : ""}${item.alternative ? " (alternative)" : ""}`.slice(0,160), details: [item.participantNote, chosenShortlistOption(item) ? participantOptionDetails(chosenShortlistOption(item)!) : null].filter(Boolean).join(" · "), venue: item.venue ?? "", kind: item.kind === "downtime" ? "open" : item.kind, status: "tentative",
      ...(item.decision && !chosenShortlistOption(item) ? { choices: { question: item.decision.question, options: item.decision.options.map(label => {
        // Shortlist options keep stable identity and add only public, scoped facts.
        const option = item.decision?.shortlist?.find(row => row.label === label);
        if (!option) return { id: id(`choice:${item.id}:${label}`), label };
        return { id: id(`choice:${item.id}:option:${option.id}`), label, details: participantOptionDetails(option), ...(publicOptionLink(option, evidence) ? { url: publicOptionLink(option, evidence)! } : {}) };
      }) } } : {}) })),
  })), otherIdeas: content.items.filter(item => !item.day).map(item => ({ id: id(`item:${item.id}`), title: item.title, details: item.participantNote ?? "" })) });
  return { title: snapshot.title, intro: opening ? opening.length <= 500 ? opening : null : "How does this rough trip feel? Suggest changes, choose preferences for open stops, suggest meal places, and flag optional interests. Nothing is booked or assigned by a response.", presentationVersion: 2, ballotMode: "transparent",
    communication: { heading: snapshot.title, paragraphs: [opening ?? "Here’s our rough itinerary. Tell us what feels good and what you would change, suggest places for open meals, and flag interest in optional activities."], links: [] },
    questions: [{ id: id("question"), kind: "choice", prompt: "Suggestions and preferences for the itinerary", required: false, selectionMode: "single", itinerary: snapshot, options: [] }, ...(content.questions ?? []).filter(question => !question.resolved).map(question => ({ id: id(`feedback:${question.id}`), kind: "text" as const, required: false, prompt: question.prompt }))] };
}

/** The primary public source for an option, if one was captured. */
function publicOptionLink(option: ShortlistOption, evidence: Array<{ runId: string; sourceId: string; url: string }>) {
  // Recompute the basis from the host; only https links within the snapshot limit are shared.
  for (const ref of option.sources) {
    const url = evidence.find(row => row.runId === ref.runId && row.sourceId === ref.sourceId)?.url;
    if (url && /^https:\/\//i.test(url) && url.length <= 2048 && sourceBasis(option.label, url) === "primary") return url;
  }
  return null;
}

/** Removed imports may have influenced any unsaved field. Without trustworthy
 * field lineage, clear that private derived content rather than re-send it later.
 * Explicitly saved records and their receipts remain intact.
 */
export function invalidateImportedItineraryContent(draft: ItineraryDraft): ItineraryContent {
  const saved = new Set(draft.receipts.map(receipt => receipt.candidateId));
  return { ...draft.content, title: "Trip itinerary", brief: "", opening: null, closing: null, days: null, questions: null, driverBrief: "", unresolved: [],
    // Approval saved canonical title/date/time/location, not private draft notes,
    // unresolved claims or a transport location. Those still need invalidation.
    items: draft.content.items.filter(item => saved.has(item.id)).map(item => ({ ...item, note: "", participantNote: null, decision: null, unresolved: [], ...(item.kind === "transport" ? { location: "" } : {}) })),
    tasks: draft.content.tasks.filter(task => saved.has(task.id)) };
}

/** The canonical fields an approved itinerary item proposes. Notes, costs, bookings and participants are never proposed here. */
export type PlanProposalFields = { title: string; date: string | null; time: string | null; durationMinutes: number | null; location: string | null; sourceUrl: string | null };
export type PlanUpdateField = "title" | "date" | "time" | "duration" | "location" | "sourceUrl";
export function chosenShortlistOption(item: ItineraryContent["items"][number]) {
  const id = item.decision?.chosenOptionId;
  return id ? item.decision?.shortlist?.find(option => option.id === id) ?? null : null;
}
export function itineraryPlanFields(item: ItineraryContent["items"][number], evidence: Array<{ runId: string; sourceId: string; url: string }>): PlanProposalFields {
  const chosen = chosenShortlistOption(item);
  const url = (ref: { runId: string; sourceId: string } | undefined) => ref ? evidence.find(row => row.runId === ref.runId && row.sourceId === ref.sourceId)?.url ?? null : null;
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  return {
    title: (chosen ? `${item.title}: ${chosen.label}` : item.title).slice(0, 160),
    date: item.day, time: item.time,
    durationMinutes: item.time && item.endTime ? minutes(item.endTime) - minutes(item.time) : null,
    // Approximate prose stays approximate text; nothing is geocoded or invented.
    location: (chosen?.location ?? item.location).trim() || null,
    sourceUrl: chosen ? url(chosen.sources.find(source => source.basis === "primary") ?? chosen.sources[0]) : url(item.sources[0]),
  };
}
/** Field-level differences against the saved record. Absent proposal values never clear saved data. */
export function planFieldChanges(proposed: PlanProposalFields, saved: { title: string; date: string | null; time: string | null; durationMinutes: number | null; location: string | null; sourceUrl: string | null }) {
  const changes: Array<{ field: PlanUpdateField; from: string | number | null; to: string | number | null }> = [];
  if (proposed.title !== saved.title) changes.push({ field: "title", from: saved.title, to: proposed.title });
  if (proposed.date !== saved.date) changes.push({ field: "date", from: saved.date, to: proposed.date });
  if (proposed.time !== saved.time) changes.push({ field: "time", from: saved.time, to: proposed.time });
  if (proposed.durationMinutes !== null && proposed.durationMinutes !== saved.durationMinutes) changes.push({ field: "duration", from: saved.durationMinutes, to: proposed.durationMinutes });
  if (proposed.location !== null && proposed.location !== saved.location) changes.push({ field: "location", from: saved.location, to: proposed.location });
  if (proposed.sourceUrl !== null && proposed.sourceUrl !== saved.sourceUrl) changes.push({ field: "sourceUrl", from: saved.sourceUrl, to: proposed.sourceUrl });
  return changes;
}

export const ItineraryRequestSchema = z.object({
  kind: z.literal("itinerary"), baseVersion: z.number().int().nonnegative(),
  documentId: z.string().uuid().optional(),
  workflowKey: WorkflowKeySchema.optional(),
  importText: z.string().min(1).max(30000).refine(text=>Boolean(text.trim())).optional(),
  publicQuery: z.string().trim().min(1).max(500).optional(),
}).strict();
export const ItineraryActionSchema = z.object({
  action: z.literal("itinerary"), operation: z.enum(["revise", "undo", "apply", "remove_import", "prepare_poll", "update_plan", "link_existing"]),
  turnId: z.string().uuid(), threadId: z.string().uuid(), commandId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  revisionCommandId: z.string().uuid().optional(), undoItemId: z.string().max(80).optional(),
  content: ItineraryContentSchema.optional(), importId: z.string().uuid().optional(),
  selectedIds: z.array(z.string().max(80)).max(30).optional(), taskIds: z.array(z.string().max(80)).max(12).optional(),
  taskOwners: z.array(z.object({ taskId: z.string().max(80), ownerPersonId: z.string().uuid() }).strict()).max(12).optional(),
  // update_plan: the reviewed saved records, their reviewed row version and exact fields.
  planUpdates: z.array(z.object({ candidateId: z.string().max(80), savedId: z.string().uuid(), expectedRecordVersion: z.string().datetime(),
    fields: z.array(z.enum(["title", "date", "time", "duration", "location", "sourceUrl"])).min(1).max(6) }).strict()).max(12).optional(),
  // link_existing: bring a saved Plan activity into this document by identity.
  planItemId: z.string().uuid().optional(), expectedRecordVersion: z.string().datetime().optional(),
}).strict();

/** Shared save preflight. Partial AM/PM input remains local until its range is valid. */
export function validateItineraryTiming(content: ItineraryContent) {
  for (const item of content.items) {
    if (item.time && !item.day) throw new Error("A time needs a day.");
    if (item.endTime && (!item.time || item.endTime <= item.time)) throw new Error("End time must be after the start time on the same day. Check AM/PM.");
  }
}

/** Fail closed: model output cannot add evidence, shift trip dates or silently change saved items. */
export function validateItineraryContent(content: ItineraryContent, draft: Pick<ItineraryDraft, "facts" | "evidence" | "receipts" | "content">, options: { privateDocumentEdit?: boolean } = {}) {
  validateItineraryTiming(content);
  const ids = content.items.map(item => item.id), tasks = content.tasks.map(task => task.id);
  const days = (content.days ?? []).map(day => day.day), questions = (content.questions ?? []).map(question => question.id);
  if (new Set(days).size !== days.length || new Set(questions).size !== questions.length) throw new Error("Duplicate document sections.");
  if (days.some(day => draft.facts.startsOn && day < draft.facts.startsOn || draft.facts.endsOn && day > draft.facts.endsOn)) throw new Error("Keep the saved trip dates.");
  if (new Set([...ids, ...tasks]).size !== ids.length + tasks.length) throw new Error("Duplicate itinerary identities.");
  const knownSources = new Set(draft.evidence.map(source => `${source.runId}:${source.sourceId}`));
  for (const item of content.items) {
    if (item.travelAnchor && item.kind !== "transport") throw new Error("A flight anchor must be travel context.");
    if (item.decision && new Set(item.decision.options.map(option => option.toLowerCase())).size !== item.decision.options.length) throw new Error("Voting options must be distinct.");
    const shortlistProblem = item.decision ? shortlistError(item.decision) : null;
    if (shortlistProblem) throw new Error(shortlistProblem);
    if (item.decision?.shortlist?.some(option => option.sources.some(source => !knownSources.has(`${source.runId}:${source.sourceId}`)))) throw new Error("Unknown research source.");
    // Code decides fit: a stored option may not claim more than its captured evidence supports.
    const fitStrength = { unsuitable: 0, requires_confirmation: 1, candidate: 2 };
    if (item.decision?.shortlist?.some(option => {
      const qualified = qualifyOption(option, draft.evidence, decisionScopeFor(item));
      return fitStrength[option.fit] > fitStrength[qualified.fit]
        || option.sources.some(source => source.basis === "primary" && qualified.sources.find(ref => ref.runId === source.runId && ref.sourceId === source.sourceId)?.basis !== "primary");
    })) throw new Error("An option cannot claim a stronger fit or source basis without supporting evidence.");
    if (item.day && (draft.facts.startsOn && item.day < draft.facts.startsOn || draft.facts.endsOn && item.day > draft.facts.endsOn)) throw new Error("The draft must keep the saved trip dates.");
    if (item.sources.some(source => !knownSources.has(`${source.runId}:${source.sourceId}`))) throw new Error("Unknown research source.");
    if (item.evidence === "researched_claim" && !item.sources.length) throw new Error("Researched claims need evidence.");
  }
  for (const task of content.tasks) if (task.itemId && !ids.includes(task.itemId)) throw new Error("A follow-up needs an existing candidate.");
  for (const receipt of options.privateDocumentEdit ? [] : draft.receipts) {
    const before = receipt.kind === "task" ? draft.content.tasks.find(item => item.id === receipt.candidateId) : draft.content.items.find(item => item.id === receipt.candidateId);
    const after = receipt.kind === "task" ? content.tasks.find(item => item.id === receipt.candidateId) : content.items.find(item => item.id === receipt.candidateId);
    // Legacy candidates omit new nullable fields; absence and null both mean unset.
    // Normalize only these fields, retaining every meaningful saved value.
    const comparable = (item: typeof before) => {
      if (receipt.kind === "task" || !item) return item;
      const candidate = ItineraryCandidateSchema.parse(item);
      return ItineraryCandidateSchema.parse({ ...candidate, endTime: candidate.endTime ?? null, travelAnchor: candidate.travelAnchor ?? null,
        decision: candidate.decision ?? null, participantNote: candidate.participantNote ?? null, venue: candidate.venue ?? null });
    };
    if (JSON.stringify(comparable(before)) !== JSON.stringify(comparable(after))) throw new Error("This item is already saved. Edit it in Plan; the research draft cannot overwrite it.");
  }
  return content;
}
