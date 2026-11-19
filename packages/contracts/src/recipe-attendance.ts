import { z } from "zod";
import { attendanceLabels, attendanceStates, partySizeLabel, type AttendanceState } from "./poll-recipe-fields";
import type { PollOption, PollQuestion, PollWorkingData } from "./poll";
import { TripDatesLocationSchema, type TripDatesLocation } from "./recipe";
import { formatTripDateRange } from "./attendance";

/* Attendance as a poll answer. It is the group's answer to the organizers, never an RSVP, an invitation acceptance or an account. */

export const ATTENDANCE_PROMPT = "Will you be there?";
export const PARTY_PROMPT = "How many people are you answering for, including you?";
export const ATTENDANCE_NOTE_PROMPT = "Anything the organizers should know?";
export const PARTY_SIZES = [1, 2, 3, 4, 5, 6] as const;

export function attendanceQuestions(questions: PollQuestion[]) {
  const state = questions.find((question): question is Extract<PollQuestion, { kind: "choice" }> => question.kind === "choice" && question.options.some(option => option.attendance));
  if (!state) return null;
  const party = questions.find((question): question is Extract<PollQuestion, { kind: "choice" }> => question.kind === "choice" && question.options.some(option => option.partySize)) ?? null;
  const note = questions.find((question): question is Extract<PollQuestion, { kind: "text" }> => question.kind === "text") ?? null;
  return { state, party, note };
}

export function buildAttendancePollData(input: { trip: TripDatesLocation; title?: string; previous?: Pick<PollWorkingData, "questions"> | null }): PollWorkingData {
  const trip = TripDatesLocationSchema.parse(input.trip);
  const prior = input.previous ? attendanceQuestions(input.previous.questions as PollQuestion[]) : null;
  const newId = () => globalThis.crypto.randomUUID();
  const stateOption = (state: AttendanceState): PollOption => ({ id: prior?.state.options.find(option => option.attendance === state)?.id ?? newId(), label: attendanceLabels[state], description: null, exclusive: false, attendance: state });
  const partyOption = (size: number): PollOption => ({ id: prior?.party?.options.find(option => option.partySize === size)?.id ?? newId(), label: partySizeLabel(size), description: null, exclusive: false, partySize: size });
  const when = trip.startsOn && trip.endsOn ? formatTripDateRange(trip.startsOn, trip.endsOn) : "dates to be confirmed";
  const where = trip.locationNames.length ? ` in ${trip.locationNames.join(", ")}` : "";
  return {
    recipeTrip: trip,
    title: (input.title?.trim() || "Can you make it?").slice(0, 120),
    intro: `${when}${where}. Your answer goes to the organizers to help them plan. It doesn’t accept an invitation or change your RSVP on the trip.`,
    ballotMode: "transparent",
    questions: [
      { id: prior?.state.id ?? newId(), kind: "choice", prompt: ATTENDANCE_PROMPT, required: true, selectionMode: "single", options: attendanceStates.map(stateOption) },
      { id: prior?.party?.id ?? newId(), kind: "choice", prompt: PARTY_PROMPT, required: false, selectionMode: "single", options: PARTY_SIZES.map(partyOption) },
      { id: prior?.note?.id ?? newId(), kind: "text", prompt: ATTENDANCE_NOTE_PROMPT, required: false },
    ],
  };
}

export type AttendanceParticipant = { key: string; name: string };
export type AttendanceResponseFact = AttendanceParticipant & { responseId: string; guest: boolean; state: AttendanceState | null; partySize: number | null; note: string | null; hasNeed: boolean };
export type AttendanceEntry = AttendanceParticipant & { state: AttendanceState; partySize: number | null; note: string | null; enteredBy: string };
export type AttendancePerson = { key: string; name: string; state: AttendanceState | "unanswered"; partySize: number | null; source: "response" | "organizer_entered" | "none"; note: string | null; enteredBy: string | null; responseId: string | null };
export type AttendanceSummary = {
  people: AttendancePerson[];
  counts: Record<AttendanceState | "unanswered", number>;
  /** People covered by each answer. A missing party size counts as one and is listed so it can be checked. */
  headcount: { in: number; maybe: number; assumedOne: string[] };
  /** Names answered more than once from outside the audience; counted once each only after an organizer chooses. */
  duplicates: Array<{ name: string; responseIds: string[]; answers: Array<{ responseId: string; state: AttendanceState | null; partySize: number | null }> }>;
  superseded: string[];
};

/**
 * Pure and transparent. A person's own answer always wins over an organizer-entered note about them; silence is `unanswered`,
 * never a yes or a no; and guests who share a name are never merged silently.
 */
export function summarizeAttendance(input: { audience: AttendanceParticipant[]; responses: AttendanceResponseFact[]; entries: AttendanceEntry[]; excludedResponseIds?: string[] }): AttendanceSummary {
  const excluded = new Set(input.excludedResponseIds ?? []);
  const counted = input.responses.filter(response => !excluded.has(response.responseId));
  const byKey = new Map<string, AttendanceResponseFact>();
  const duplicates: AttendanceSummary["duplicates"] = [];
  const seenNames = new Map<string, string[]>();
  for (const response of counted) {
    if (response.guest) seenNames.set(response.key, [...(seenNames.get(response.key) ?? []), response.responseId]);
    if (!byKey.has(response.key)) byKey.set(response.key, response);
  }
  for (const [key, ids] of seenNames) if (ids.length > 1) duplicates.push({ name: counted.find(response => response.key === key)!.name, responseIds: ids,
    answers: ids.map(responseId => { const response = counted.find(item => item.responseId === responseId)!; return { responseId, state: response.state, partySize: response.partySize }; }) });
  const people: AttendancePerson[] = [], handled = new Set<string>(), superseded: string[] = [];
  const entryFor = (key: string) => input.entries.find(entry => entry.key === key);
  const add = (participant: AttendanceParticipant) => {
    if (handled.has(participant.key)) return; handled.add(participant.key);
    const response = byKey.get(participant.key), entry = entryFor(participant.key);
    if (response?.state) { if (entry) superseded.push(participant.name); people.push({ key: participant.key, name: participant.name, state: response.state, partySize: response.partySize, source: "response", note: response.note, enteredBy: null, responseId: response.responseId }); }
    else if (entry) people.push({ key: participant.key, name: participant.name, state: entry.state, partySize: entry.partySize, source: "organizer_entered", note: entry.note, enteredBy: entry.enteredBy, responseId: null });
    else people.push({ key: participant.key, name: participant.name, state: "unanswered", partySize: null, source: "none", note: null, enteredBy: null, responseId: null });
  };
  for (const person of input.audience) add(person);
  for (const response of counted) add({ key: response.key, name: response.name });
  for (const entry of input.entries) add({ key: entry.key, name: entry.name });
  const counts = { in: 0, maybe: 0, out: 0, unanswered: 0 };
  const headcount = { in: 0, maybe: 0, assumedOne: [] as string[] };
  for (const person of people) {
    counts[person.state]++;
    if (person.state === "in" || person.state === "maybe") { headcount[person.state] += person.partySize ?? 1; if (!person.partySize) headcount.assumedOne.push(person.name); }
  }
  return { people, counts, headcount, duplicates, superseded };
}

export const AttendanceOutcomeSchema = z.object({
  kind: z.literal("attendance"),
  counts: z.object({ in: z.number().int().nonnegative(), maybe: z.number().int().nonnegative(), out: z.number().int().nonnegative(), unanswered: z.number().int().nonnegative() }).strict(),
  headcount: z.object({ in: z.number().int().nonnegative(), maybe: z.number().int().nonnegative() }).strict(),
  people: z.array(z.object({ personId: z.string().uuid().nullable(), name: z.string().max(120), state: z.enum(["in", "maybe", "out", "unanswered"]), partySize: z.number().int().min(1).max(12).nullable(),
    source: z.enum(["response", "organizer_entered", "none"]), note: z.string().max(1000).nullable(), enteredBy: z.string().max(120).nullable() }).strict()).max(200),
  exceptions: z.array(z.string().trim().min(1).max(300)).max(10),
  excludedResponses: z.number().int().nonnegative(),
  /** Trip dates and location this was asked about. A later change makes the result stale; it never rewrites it. */
  basedOn: TripDatesLocationSchema,
}).strict();
export type AttendanceOutcome = z.infer<typeof AttendanceOutcomeSchema>;

export const StartAttendanceRunSchema = z.object({ commandId: z.string().uuid(), runId: z.string().uuid(), draftId: z.string().uuid(), recipe: z.literal("attendance"), title: z.string().trim().max(120).optional() }).strict();
export const SaveAttendanceSchema = z.object({ commandId: z.string().uuid(), expectedDraftVersion: z.number().int().positive(), title: z.string().trim().max(120).optional() }).strict();
export const ApproveAttendanceSchema = z.object({
  commandId: z.string().uuid(), pollId: z.string().uuid(), evidenceFingerprint: z.string().length(64),
  exceptions: z.array(z.string().trim().min(1).max(300)).max(10).default([]),
  /** Organizer-attributed notes about people who haven't answered. They never become that person's own answer or RSVP. */
  organizerEntries: z.array(z.object({ personId: z.string().uuid(), state: z.enum(attendanceStates), partySize: z.number().int().min(1).max(12).nullable().default(null), note: z.string().trim().max(300).nullable().default(null) }).strict()).max(100).default([]),
  /** Duplicate guest answers an organizer chose not to count. Nothing is merged or deleted. */
  excludedResponseIds: z.array(z.string().uuid()).max(100).default([]),
  needResolutions: z.array(z.object({ responseId: z.string().uuid(), questionId: z.string().uuid(), resolution: z.string().trim().min(1).max(500) }).strict()).max(200).default([]),
  uncertaintyAcknowledged: z.literal(true),
}).strict();
export type ApproveAttendance = z.infer<typeof ApproveAttendanceSchema>;
