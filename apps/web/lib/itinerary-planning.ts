import { z } from "zod";
import { ItineraryPollSnapshotSchema, PollWorkingDataSchema, type ItineraryPollItem, type PollWorkingData, type TripContextSnapshot } from "@commons/contracts";
import { itineraryQuestion } from "./itinerary-workshop";

// The model can propose bounded operations, never replace an entire poll or invent object identities.
const itemFields = {
  title: z.string().trim().min(1).max(160), time: z.string().max(80), details: z.string().max(4000),
  venue: z.string().max(160), kind: z.enum(["activity", "meal", "transport", "open"]),
};
export const ItineraryPlanningReplySchema = z.object({
  reply: z.string().trim().min(1).max(1200),
  operations: z.array(z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("update_opening"), text: z.string().max(1500) }).strict(),
    z.object({ kind: z.literal("update_title"), title: z.string().trim().min(1).max(160) }).strict(),
    z.object({ kind: z.literal("add_question"), prompt: z.string().trim().min(1).max(240) }).strict(),
    z.object({ kind: z.literal("update_question"), questionId: z.string().uuid(), prompt: z.string().trim().min(1).max(240) }).strict(),
    z.object({ kind: z.literal("remove_question"), questionId: z.string().uuid() }).strict(),
    z.object({ kind: z.literal("update_item"), itemId: z.string().uuid(), fields: z.object(itemFields).strict() }).strict(),
    z.object({ kind: z.literal("add_item"), dayId: z.string().uuid(), afterItemId: z.string().uuid().nullable(), fields: z.object(itemFields).strict() }).strict(),
    z.object({ kind: z.literal("remove_item"), itemId: z.string().uuid() }).strict(),
    z.object({ kind: z.literal("move_item"), itemId: z.string().uuid(), dayId: z.string().uuid(), afterItemId: z.string().uuid().nullable() }).strict(),
    z.object({ kind: z.literal("update_day"), dayId: z.string().uuid(), label: z.string().trim().min(1).max(100), description: z.string().max(4000) }).strict(),
    z.object({ kind: z.literal("add_day"), label: z.string().trim().min(1).max(100), description: z.string().max(4000), items: z.array(z.object(itemFields).strict()).max(40) }).strict(),
    z.object({ kind: z.literal("add_idea"), title: z.string().trim().min(1).max(160), details: z.string().max(1000) }).strict(),
    z.object({ kind: z.literal("update_idea"), ideaId: z.string().uuid(), title: z.string().trim().min(1).max(160), details: z.string().max(1000) }).strict(),
    z.object({ kind: z.literal("remove_idea"), ideaId: z.string().uuid() }).strict(),
  ])).max(40),
}).strict();
export type ItineraryPlanningReply = z.infer<typeof ItineraryPlanningReplySchema>;

export function itineraryPlanningBasis(context: TripContextSnapshot) {
  const rows = (facts: Array<{ id: string; version: string | number }>) => facts.map(fact => ({ id: fact.id, version: String(fact.version) }));
  return { tripVersion: String(context.trip.version), travelers: rows(context.travelers), stays: rows(context.stays), plans: rows(context.plans), logistics: rows(context.logistics) };
}

// Airport arrival/departure wording from imported plans is protected even before confirmation.
export function isFlightAnchor(item: ItineraryPollItem) {
  return /\b(?:flight|land(?:ing)?(?: at)?|take.?off|airport)\b/i.test(item.title)
    || (/\b(?:arriv(?:e|al|ing)|depart(?:ure|ing)?)\b/i.test(item.title) && /\b[A-Z]{3}\b/.test(item.title));
}

/** Pure, atomic validation. Unmentioned rows, statuses, poll options, recipients and private source remain byte-for-byte intact. */
export function prepareItineraryProposal(data: PollWorkingData, raw: unknown, id: (index: number) => string, request?: string) {
  const reply = ItineraryPlanningReplySchema.parse(raw), question = itineraryQuestion(data.questions);
  if (!question) throw new Error("Select an editable itinerary first.");
  const next = structuredClone(question.itinerary), changes: string[] = [];
  let message = { ...data };
  const namedDays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].filter(name => new RegExp(`\\b${name}\\b`, "i").test(request ?? ""));
  const dayScoped = namedDays.length && !/\b(?:whole|entire|overall|every day|all days|opening|title|question)\b/i.test(request ?? "");
  const inScope = (dayId: string) => next.days.some(day => day.id === dayId && namedDays.some(name => new RegExp(`\\b${name}\\b`, "i").test(day.label)));
  const itemInScope = (itemId: string) => next.days.some(day => inScope(day.id) && day.items.some(item => item.id === itemId));
  const day = (dayId: string) => {
    const found = next.days.find(value => value.id === dayId);
    if (!found) throw new Error("The requested itinerary day is no longer available.");
    return found;
  };
  const item = (itemId: string) => {
    const parent = next.days.find(value => value.items.some(stop => stop.id === itemId));
    const found = parent?.items.find(stop => stop.id === itemId);
    if (!parent || !found) throw new Error("The requested itinerary stop is no longer available.");
    // These anchors can be edited manually, not quietly moved by a model during a rewrite.
    if (found.status === "confirmed" || found.planItemId || isFlightAnchor(found)) throw new Error("Keep confirmed plans and flight anchors unchanged. Edit those directly if they need to change.");
    return { parent, found };
  };
  const insert = (parent: ReturnType<typeof day>, stop: ItineraryPollItem, after: string | null) => {
    const index = after === null ? -1 : parent.items.findIndex(value => value.id === after);
    if (after !== null && index < 0) throw new Error("The requested position is no longer available.");
    parent.items.splice(index + 1, 0, stop);
  };
  reply.operations.forEach((op, index) => {
    if (dayScoped) {
      const allowed = op.kind === "update_item" || op.kind === "remove_item" ? itemInScope(op.itemId) : op.kind === "move_item" ? itemInScope(op.itemId) && inScope(op.dayId) : op.kind === "add_item" || op.kind === "update_day" ? inScope(op.dayId) : op.kind === "add_day" ? namedDays.some(name => new RegExp(`\\b${name}\\b`, "i").test(op.label)) : false;
      if (!allowed) return;
    }
    switch (op.kind) {
      case "update_opening": message = { ...message, intro: op.text.length <= 500 ? op.text : null, communication: op.text.trim() ? { heading: message.communication?.heading ?? message.title, paragraphs: [op.text], links: message.communication?.links ?? [] } : undefined }; changes.push("Update opening"); break;
      case "update_title": next.title = op.title; message = { ...message, title: op.title }; changes.push("Update title"); break;
      case "add_question":
        if (message.questions.filter(row => row.kind === "text").length >= 3) throw new Error("Keep up to three optional questions.");
        message = { ...message, questions: [...message.questions, { id: id(2000 + index), kind: "text", required: false, prompt: op.prompt }] }; changes.push("Add optional question"); break;
      case "update_question": case "remove_question": {
        if (!message.questions.some(row => row.id === op.questionId && row.kind === "text")) throw new Error("That optional question is no longer available.");
        message = { ...message, questions: op.kind === "remove_question" ? message.questions.filter(row => row.id !== op.questionId) : message.questions.map(row => row.id === op.questionId ? { ...row, prompt: op.prompt } : row) }; changes.push("Update optional question"); break;
      }
      case "update_item": {
        const { found } = item(op.itemId);
        Object.assign(found, op.fields); changes.push(`Update ${found.title}`); break;
      }
      case "add_item": insert(day(op.dayId), { id: id(index), ...op.fields, status: "tentative" }, op.afterItemId); changes.push(`Add ${op.fields.title}`); break;
      case "remove_item": {
        const { parent, found } = item(op.itemId);
        parent.items = parent.items.filter(value => value.id !== op.itemId); changes.push(`Remove ${found.title}`); break;
      }
      case "move_item": {
        const { parent, found } = item(op.itemId);
        if (op.afterItemId === op.itemId) throw new Error("A stop cannot follow itself.");
        parent.items = parent.items.filter(value => value.id !== op.itemId);
        insert(day(op.dayId), found, op.afterItemId); changes.push(`Move ${found.title} to ${day(op.dayId).label}`); break;
      }
      case "update_day": {
        const found = day(op.dayId);
        // Relabeling a day also moves its locked anchors in calendar terms.
        if (found.label !== op.label && found.items.some(stop => stop.status === "confirmed" || stop.planItemId || isFlightAnchor(stop))) throw new Error("Keep the day of confirmed plans and flights unchanged. Edit it directly if needed.");
        Object.assign(found, { label: op.label, description: op.description }); changes.push(`Update ${op.label}`); break;
      }
      case "add_day": next.days.push({ id: id(index), label: op.label, description: op.description, items: op.items.map((fields, offset) => ({ id: id(100 + index * 40 + offset), ...fields, status: "tentative" })) }); changes.push(`Add ${op.label} · ${op.items.length} stops`); break;
      case "add_idea": next.otherIdeas.push({ id: id(index), title: op.title, details: op.details }); changes.push(`Add optional ${op.title}`); break;
      case "update_idea": {
        const found = next.otherIdeas.find(value => value.id === op.ideaId);
        if (!found) throw new Error("The requested optional idea is no longer available.");
        Object.assign(found, { title: op.title, details: op.details }); changes.push(`Update optional ${op.title}`); break;
      }
      case "remove_idea": {
        const found = next.otherIdeas.find(value => value.id === op.ideaId);
        if (!found) throw new Error("The requested optional idea is no longer available.");
        next.otherIdeas = next.otherIdeas.filter(value => value.id !== op.ideaId); changes.push(`Remove optional ${found.title}`); break;
      }
    }
  });
  const itinerary = ItineraryPollSnapshotSchema.parse(next);
  const updated = PollWorkingDataSchema.parse({ ...message, questions: message.questions.map(value => value.id === question.id ? { ...question, itinerary } : value) });
  if (JSON.stringify(updated) === JSON.stringify(PollWorkingDataSchema.parse(data))) return null;
  return { data: updated, changes: [...new Set(changes)].slice(0, 7).map(value => value.slice(0, 120)).concat(changes.length > 7 ? [`${changes.length} proposed edits · review the full itinerary`] : []) };
}
