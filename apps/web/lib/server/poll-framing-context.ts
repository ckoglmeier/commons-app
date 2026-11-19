import { z } from "zod";
import type { PollWorkingData } from "@commons/contracts";
import { isFramingEditableQuestion } from "../poll-suggestions";

/*
 * The only trip context that reaches poll framing help. Facts come from the database package's reservation (organizer, own draft),
 * already reduced to participant-safe fields. This builder reduces them further and bounds the packet.
 *
 * Never included: participant names, emails or profiles; private plan notes; confirmation codes; private travel; other drafts;
 * Coordinator conversations; poll responses; the organizer setup brief. Travelers appear only as a count.
 */
export const POLL_FRAMING_PACKET_LIMIT = 6_000;

export type PollFramingFacts = {
  trip: { title: string; startsOn: string | null; endsOn: string | null; place: string | null; timezone: string; currency: string; travelerCount: number };
  stays: Array<{ id: string; name: string; startsOn: string; endsOn: string; status: string }>;
  activities: Array<{ id: string; title: string; startsAt: string | null; scheduledDate: string | null; timezone: string; place: string | null; status: string }>;
};

const clip = (value: string | null | undefined, max: number) => { const text = (value ?? "").replace(/\s+/g, " ").trim(); return text.length > max ? `${text.slice(0, max - 1)}…` : text; };

function localParts(startsAt: string | null, scheduledDate: string | null, timezone: string) {
  if (startsAt) {
    try {
      const date = new Date(startsAt);
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
      const weekday = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long" }).format(date);
      const time = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(date);
      return { day: `${weekday} ${day}`, time };
    } catch { /* fall through to the stored date */ }
  }
  return { day: scheduledDate, time: null };
}

const PacketOption = z.object({ id: z.string(), type: z.enum(["stay", "activity"]), title: z.string(), day: z.string().nullable(), endDay: z.string().nullable(), time: z.string().nullable(), place: z.string().nullable(), status: z.string(), sharedDescription: z.string().nullable() }).strict();
const PacketQuestion = z.object({ id: z.string(), prompt: z.string(), kind: z.enum(["choice", "text"]), required: z.boolean(), selectionMode: z.enum(["single", "multiple"]),
  options: z.array(z.object({ id: z.string(), label: z.string(), description: z.string().nullable(), exclusive: z.boolean() }).strict()) }).strict();
export const PollFramingPacketSchema = z.object({
  trip: z.object({ title: z.string(), startsOn: z.string().nullable(), endsOn: z.string().nullable(), place: z.string().nullable(), timezone: z.string(), currency: z.string(), travelerCount: z.number().int().nonnegative() }).strict(),
  options: z.array(PacketOption),
  currentDraft: z.object({ title: z.string(), intro: z.string(), questions: z.array(PacketQuestion), otherQuestions: z.array(z.string()) }).strict().nullable(),
}).strict();
export type PollFramingPacket = z.infer<typeof PollFramingPacketSchema>;
export type PollFramingContext = { packet: PollFramingPacket; editableQuestionIds: string[]; suppliedOptionIds: string[] };

type Draft = Pick<PollWorkingData, "title" | "intro" | "questions">;

function assemble(facts: PollFramingFacts, draft: Draft, level: number): PollFramingContext {
  const descriptionLimit = [120, 60, 0, 0, 0][level], labelLimit = level >= 3 ? 60 : 100;
  const optionsInDraft = new Map<string, string | null>();
  for (const question of draft.questions) if (question.kind === "choice") for (const option of question.options) optionsInDraft.set(option.id, option.description ?? null);
  const stayIds = new Set(draft.questions.flatMap(question => question.kind === "choice" ? question.options.flatMap(option => option.resource?.type === "stay" ? [option.resource.id] : []) : []));
  const supplied: z.infer<typeof PacketOption>[] = [];
  const keyOf = (id: string) => id;
  for (const stay of facts.stays) if (stayIds.has(stay.id) || optionsInDraft.has(stay.id)) supplied.push({ id: keyOf(stay.id), type: "stay", title: clip(stay.name, labelLimit), day: stay.startsOn, endDay: stay.endsOn, time: null, place: null, status: stay.status, sharedDescription: null });
  for (const activity of facts.activities) if (optionsInDraft.has(activity.id)) {
    const parts = localParts(activity.startsAt, activity.scheduledDate, activity.timezone);
    supplied.push({ id: activity.id, type: "activity", title: clip(activity.title, labelLimit), day: parts.day, endDay: null, time: parts.time, place: activity.place ? clip(activity.place, 80) : null, status: activity.status, sharedDescription: null });
  }
  // Stay options are linked by resource id; the poll option id may differ, so describe the stay by its linked option.
  const optionForStay = new Map<string, string | null>();
  for (const question of draft.questions) if (question.kind === "choice") for (const option of question.options) if (option.resource?.type === "stay" && !optionForStay.get(option.resource.id)) optionForStay.set(option.resource.id, option.description ?? null);
  const options = (level >= 4 ? [] : supplied).map(option => ({ ...option, sharedDescription: descriptionLimit ? clip(option.type === "stay" ? optionForStay.get(option.id) ?? optionsInDraft.get(option.id) : optionsInDraft.get(option.id), descriptionLimit) || null : null }));
  const editable = draft.questions.filter(isFramingEditableQuestion);
  const included: z.infer<typeof PacketQuestion>[] = [];
  const maxQuestions = level >= 4 ? 3 : 8;
  for (const question of editable.slice(0, maxQuestions)) {
    if (question.kind === "text") included.push({ id: question.id, prompt: clip(question.prompt, 200), kind: "text", required: question.required, selectionMode: "single", options: [] });
    else if (question.kind === "choice") included.push({ id: question.id, prompt: clip(question.prompt, 200), kind: "choice", required: question.required, selectionMode: question.selectionMode,
      options: question.options.slice(0, 12).map(option => ({ id: option.id, label: clip(option.label, labelLimit), description: descriptionLimit ? clip(option.description, descriptionLimit) || null : null, exclusive: option.exclusive })) });
  }
  const revising = draft.questions.length > 0 || draft.intro?.trim();
  const includedIds = new Set(included.map(question => question.id));
  const fullyIncluded = included.filter(entry => { const source = editable.find(question => question.id === entry.id); return source && (source.kind === "text" || (source.kind === "choice" && source.options.length <= 12)); });
  const editableQuestionIds = fullyIncluded.map(question => question.id);
  const suppliedOptionIds = [...new Set([...supplied.map(option => option.id), ...draft.questions.flatMap(question => question.kind === "choice" ? question.options.filter(option => option.resource).map(option => option.id) : [])])];
  return {
    packet: PollFramingPacketSchema.parse({
      trip: { title: clip(facts.trip.title, 100), startsOn: facts.trip.startsOn, endsOn: facts.trip.endsOn, place: facts.trip.place ? clip(facts.trip.place, 100) : null, timezone: facts.trip.timezone, currency: facts.trip.currency, travelerCount: facts.trip.travelerCount },
      options,
      currentDraft: revising ? { title: clip(draft.title, 120), intro: clip(draft.intro, 500), questions: included,
        otherQuestions: draft.questions.filter(question => !includedIds.has(question.id)).slice(0, 4).map(question => clip(question.prompt, 80)) } : null,
    }),
    editableQuestionIds, suppliedOptionIds,
  };
}

/** Builds the bounded packet, trimming detail in stages until it fits. A question that was cut is never reported as editable. */
export function buildPollFramingContext(facts: PollFramingFacts, draft: Draft): PollFramingContext {
  for (let level = 0; level <= 4; level += 1) {
    const context = assemble(facts, draft, level);
    if (JSON.stringify(context.packet).length <= POLL_FRAMING_PACKET_LIMIT) return context;
  }
  const last = assemble(facts, { ...draft, questions: [] }, 4);
  return { ...last, editableQuestionIds: [] };
}
