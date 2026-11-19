import { z } from "zod";
import { MAX_POLL_QUESTIONS, MAX_CONVERGENCE_OPTIONS } from "./poll-limits";
import { AttendanceStateSchema, PartySizeSchema, PollPropertySchema, SleepingNeedSchema, attendanceLabels, partySizeLabel, sleepingLabels } from "./poll-recipe-fields";
import { PollAvailabilitySchema, PollScheduleSchema, PollAlternativeSchema, formatPollSchedule, formatAlternativeLabel } from "./poll-availability";
import { PollCommunicationSchema } from "./poll-communication";
import { ItineraryPollSnapshotSchema, ItineraryPollFeedbackSchema, itineraryDecisionLabels } from "./itinerary-poll";
export * from "./poll-communication";
export * from "./poll-ballot";

export * from "./poll-limits";
export const PollConvergenceSchema = z.object({ dimension: z.enum(["dates", "location", "combination"]), measure: z.enum(["availability", "interest", "preference"]) }).strict();
export const PollOptionResponseValueSchema = z.enum(["yes", "maybe", "no", "not_interested", "could_go", "interested", "top_choice", "abstain"]);

export const PollBallotModeSchema = z.enum(["transparent", "secret"]);
export const PollStatusSchema = z.enum(["open", "closed", "revoked"]);
export const PollPublicIdSchema = z.string().regex(/^[0-9a-f]{12}$/);
export const PollAudienceSchema = z.object({
  personIds: z.array(z.string().uuid()).max(100),
  guestEmails: z.array(z.string().trim().email().toLowerCase()).max(100),
}).refine(value => value.personIds.length + value.guestEmails.length > 0, "Choose at least one recipient.");
export type PollAudience = z.infer<typeof PollAudienceSchema>;
export const PollHousingSchema = z.object({
  stage: z.enum(["illustrative", "quoted"]),
  nights: z.number().int().min(1).max(365),
  people: z.number().int().min(1).max(100),
  rooms: z.string().trim().min(1).max(180),
  totalCents: z.number().int().min(0).max(100_000_000).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  fees: z.enum(["included", "excluded", "unknown"]),
  cancellation: z.string().trim().max(300).nullable(),
  checkedOn: z.iso.date().nullable(),
}).superRefine((value, context) => {
  if (value.stage === "illustrative" && value.totalCents !== null) context.addIssue({ code: "custom", path: ["totalCents"], message: "Illustrative concepts are not price quotes. Leave the price unknown." });
  if (value.stage === "quoted" && (!value.checkedOn || value.totalCents === null)) context.addIssue({ code: "custom", message: "A real housing comparison needs a supplied total and the date it was checked." });
});

export const PollOptionSchema = z.object({
  place: z.object({ name: z.string().trim().min(1).max(60) }).strict().optional(),
  schedule: PollScheduleSchema.optional(),
  housing: PollHousingSchema.optional(),
  /** Typed date-and-place combination. The label is derived from it, never the other way around. */
  alternative: PollAlternativeSchema.optional(),
  /** Recipe markers: an attendance answer, a party size, a sleeping need, or a supplied lodging option. */
  attendance: AttendanceStateSchema.optional(),
  partySize: PartySizeSchema.optional(),
  sleeping: SleepingNeedSchema.optional(),
  property: PollPropertySchema.optional(),
  id: z.string().uuid(),
  label: z.string().trim().min(1).max(160),
  description: z.string().trim().max(180).nullable().default(null),
  exclusive: z.boolean().default(false),
  url: z.string().url().max(2_048).refine((value) => /^https?:\/\//i.test(value), "Use an http or https link.").nullable().optional(),
  resource: z.object({
    type: z.literal("stay"),
    id: z.string().uuid(),
  }).nullable().optional(),
});

const PollQuestionBaseSchema = z.object({
  convergence: PollConvergenceSchema.optional(),
  organizerOnly: z.boolean().optional(),
  id: z.string().uuid(),
  prompt: z.string().trim().min(1).max(240),
  required: z.boolean().default(true),
});

export const PollChoiceQuestionSchema = PollQuestionBaseSchema.extend({
  kind: z.literal("choice"),
  itinerary: ItineraryPollSnapshotSchema.optional(),
  availability: PollAvailabilitySchema.optional(),
  selectionMode: z.enum(["single", "multiple"]),
  options: z.array(PollOptionSchema).max(12),
});

export const PollTextQuestionSchema = PollQuestionBaseSchema.extend({
  foodField: z.enum(["requirements", "preferences", "notes"]).optional(),
  kind: z.literal("text"),
  required: z.boolean().default(false),
});

export const PollOptionResponseQuestionSchema = PollQuestionBaseSchema.extend({
  kind: z.literal("option_response"), scale: z.enum(["yes_maybe_no", "interest"]),
  availability: PollAvailabilitySchema.optional(), options: z.array(PollOptionSchema).min(2).max(MAX_CONVERGENCE_OPTIONS),
});
export const PollRankingQuestionSchema = PollQuestionBaseSchema.extend({
  kind: z.literal("ranking"), options: z.array(PollOptionSchema).min(2).max(MAX_CONVERGENCE_OPTIONS),
});
export const PollAllocationQuestionSchema = PollQuestionBaseSchema.extend({
  kind: z.literal("allocation"), totalPoints: z.literal(10), options: z.array(PollOptionSchema).min(2).max(MAX_CONVERGENCE_OPTIONS),
});

export const PollQuestionSchema = z.discriminatedUnion("kind", [
  PollChoiceQuestionSchema,
  PollTextQuestionSchema,
  PollOptionResponseQuestionSchema, PollRankingQuestionSchema, PollAllocationQuestionSchema,
]);

export const PollAnswerSchema = z.object({
  optionResponses: z.array(z.object({ optionId: z.string().uuid(), value: PollOptionResponseValueSchema }).strict()).max(MAX_CONVERGENCE_OPTIONS).optional(),
  rankedOptionIds: z.array(z.string().uuid()).max(MAX_CONVERGENCE_OPTIONS).optional(),
  allocations: z.array(z.object({ optionId: z.string().uuid(), points: z.number().int().min(0).max(10) }).strict()).max(MAX_CONVERGENCE_OPTIONS).optional(),
  abstained: z.literal(true).optional(),
  questionId: z.string().uuid(),
  itineraryFeedback: ItineraryPollFeedbackSchema.optional(),
  optionIds: z.array(z.string().uuid()).max(12).default([]),
  text: z.string().trim().max(1_000).nullable().default(null),
  context: z.object({
    kind: z.enum(["preference", "need", "note"]),
    text: z.string().trim().min(1).max(1_000),
  }).optional(),
});

export const CreatePollRequestSchema = z.object({
  commandId: z.string().uuid(),
  draftId: z.string().uuid().optional(),
  draftVersion: z.number().int().positive().optional(),
  communication: PollCommunicationSchema.optional(),
  deliveryApproval: z.object({ approved: z.literal(true), fingerprint: z.string().length(64) }).optional(),
  shareApproval: z.object({ approved: z.literal(true) }).optional(),
  publicationApproval: z.object({ approved: z.literal(true), access: z.enum(["invitees", "link"]).optional() }).optional(),
  audience: PollAudienceSchema.optional(),
  sourcePollId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(120),
  intro: z.string().trim().max(500).nullable().default(null),
  ballotMode: PollBallotModeSchema,
  questions: z.array(PollQuestionSchema).min(1).max(MAX_POLL_QUESTIONS),
}).superRefine((value, context) => {
  if (value.publicationApproval && (!value.draftId || value.audience || value.shareApproval || value.deliveryApproval)) context.addIssue({ code: "custom", message: "Publish the reviewed draft with the selected access without sending it.", path: ["publicationApproval"] });
  if (value.deliveryApproval && value.shareApproval) context.addIssue({ code: "custom", message: "Choose Commons delivery or copy a share link, not both.", path: ["shareApproval"] });
  if (value.deliveryApproval && (!value.draftId || !value.communication || !value.audience)) context.addIssue({ code: "custom", message: "Review the saved message and exact recipients before sending.", path: ["deliveryApproval"] });
  if (value.shareApproval && (!value.draftId || !value.communication || value.audience)) context.addIssue({ code: "custom", message: "Review the saved message and poll before creating a share link.", path: ["shareApproval"] });
  if (value.communication && !value.deliveryApproval && !value.shareApproval && !value.publicationApproval) context.addIssue({ code: "custom", message: "Approve how this saved message and poll will be shared.", path: ["communication"] });
  if (Boolean(value.draftId) !== Boolean(value.draftVersion)) context.addIssue({ code: "custom", message: "Review the current saved draft before sharing.", path: ["draftId"] });
  const questionIds = value.questions.map((question) => question.id);
  if (new Set(questionIds).size !== questionIds.length) {
    context.addIssue({ code: "custom", message: "Each poll question must be unique.", path: ["questions"] });
  }
  for (const [questionIndex, question] of value.questions.entries()) {
    if (question.kind === "text") {
      if (question.convergence) context.addIssue({ code: "custom", message: "Written answers cannot establish typed availability or preference.", path: ["questions", questionIndex] });
      continue;
    }
    if (question.kind !== "choice") {
      const issue = (message: string) => context.addIssue({ code: "custom", message, path: ["questions", questionIndex] });
      if (new Set(question.options.map(option => option.id)).size !== question.options.length) issue("Each answer option must be unique.");
      if (question.options.some(option => option.exclusive || option.attendance || option.partySize || option.sleeping || option.property || option.housing || option.resource)) issue("This format supports only date, place or combination options.");
      const measure = question.kind === "option_response" ? question.scale === "interest" ? "interest" : "availability" : "preference";
      if (question.convergence && question.convergence.measure !== measure) issue("The question measure must match its answer format.");
      for (const option of question.options) {
        if ([option.schedule, option.place, option.alternative].filter(Boolean).length > 1) issue("An option can carry only one marker.");
        if (option.place && option.label !== option.place.name) issue("Review the place labels before sharing.");
        if (option.alternative && (option.alternative.endsOn < option.alternative.startsOn || option.label !== formatAlternativeLabel(option.alternative))) issue("Review the date-and-place options before sharing.");
        if (question.convergence?.dimension === "location" && !option.place || question.convergence?.dimension === "combination" && !option.alternative || question.convergence?.dimension === "dates" && !option.schedule) issue("Each option needs the marker for this question’s dimension.");
        if (option.schedule) {
          if (question.kind === "option_response" && !question.availability) { issue("Date options need an availability question."); continue; }
          const schedule = option.schedule, availability = question.kind === "option_response" ? question.availability! : { mode: "ranges" as const, timezone: "UTC" };
          if (schedule.endsOn < schedule.startsOn || availability.mode !== "ranges" && schedule.endsOn !== schedule.startsOn) issue("Review the date range.");
          if (availability.mode === "times" ? !schedule.startTime || !schedule.endTime || schedule.endTime <= schedule.startTime : Boolean(schedule.startTime || schedule.endTime)) issue("Review the time window.");
          if (option.label !== formatPollSchedule(schedule, availability)) issue("Review the date labels before sharing.");
        }
      }
      const optionMeanings = question.options.map(option => option.place ? `place:${option.place.name.toLocaleLowerCase()}` : option.alternative ? `combination:${option.alternative.startsOn}|${option.alternative.endsOn}|${option.alternative.place.toLocaleLowerCase()}` : option.schedule ? `schedule:${JSON.stringify(option.schedule)}` : `label:${option.label.toLocaleLowerCase()}`);
      if (new Set(optionMeanings).size !== optionMeanings.length) issue("Each option must be different.");
      if (question.kind === "option_response" && question.availability && (question.scale !== "yes_maybe_no" || question.options.some(option => !option.schedule) || new Set(question.options.map(option => JSON.stringify(option.schedule))).size !== question.options.length)) issue("Availability needs distinct scheduled options and the yes/maybe/no scale.");
      continue;
    }
    if (question.convergence && question.convergence.measure === "interest") context.addIssue({ code: "custom", message: "Use the interest response format to collect interest.", path: ["questions", questionIndex] });
    if (question.convergence?.measure === "availability" && question.selectionMode !== "multiple") context.addIssue({ code: "custom", message: "Availability choices let people select every option that works.", path: ["questions", questionIndex] });
    if (question.itinerary) {
      const pieces = question.itinerary.feedbackMode === "pieces";
      const compatibleQuestions = pieces ? value.questions.length <= 4 && value.questions.every(other => other.id === question.id || other.kind === "text" && !other.required) : value.questions.length === 1;
      if (value.ballotMode !== "transparent" || !compatibleQuestions || question.selectionMode !== "single" || (pieces ? question.options.length !== 0 || question.required : question.options.length !== 3 || question.options.some((option, index) => option.label !== itineraryDecisionLabels[index])) || question.availability) context.addIssue({ code: "custom", message: "An itinerary needs transparent feedback on its reviewed version.", path: ["questions", questionIndex] });
      if (!question.itinerary.days.some(day => day.items.length)) context.addIssue({ code: "custom", message: "Add an itinerary item before publishing.", path: ["questions", questionIndex] });
      if (!value.draftId || !value.publicationApproval) context.addIssue({ code: "custom", message: "Publish the reviewed saved itinerary draft.", path: ["draftId"] });
    } else if (question.options.length < 2) context.addIssue({ code: "custom", message: "Add at least two answer options.", path: ["questions", questionIndex, "options"] });
    const optionIds = question.options.map((option) => option.id);
    const availability = question.availability;
    const issue = (message: string) => context.addIssue({ code: "custom", message, path: ["questions", questionIndex, "options"] });
    if (availability) {
      if (question.selectionMode !== "multiple") issue("Availability questions let people choose every option that works.");
      const scheduled = question.options.filter(option => option.schedule);
      if (!scheduled.length) issue("Choose at least one date before previewing the poll.");
      if (new Set(scheduled.map(option => JSON.stringify(option.schedule))).size !== scheduled.length) issue("Each date or time option must be different.");
      for (const option of question.options) {
        const schedule = option.schedule;
        if (!schedule) {
          if (!option.exclusive) issue("Each availability option needs a date, or must be an exclusive answer.");
          continue;
        }
        if (option.exclusive || option.housing || option.resource) issue("Date options cannot also be housing, linked stays, or exclusive answers.");
        if (schedule.endsOn < schedule.startsOn) issue("The end date must be on or after the start date.");
        if (availability.mode !== "ranges" && schedule.endsOn !== schedule.startsOn) issue("Use Trip date ranges for options spanning more than one day.");
        if (availability.mode === "times") {
          if (!schedule.startTime || !schedule.endTime || schedule.endTime <= schedule.startTime) issue("Add a start and later end time on the same day.");
        } else if (schedule.startTime || schedule.endTime) issue("Use Dates and times to include a time window.");
        if (option.label !== formatPollSchedule(schedule, availability)) issue("Review the date labels before sharing.");
      }
    } else if (question.options.some(option => option.schedule)) issue("Date options need an availability question.");
    for (const option of question.options) {
      const markers = [option.place, option.alternative, option.attendance, option.partySize, option.sleeping, option.property].filter(item => item !== undefined).length;
      if (markers > 1) issue("An option can carry only one kind of recipe marker.");
      if (markers && (option.exclusive || option.schedule || option.housing || option.resource)) issue("A recipe option cannot also be scheduled, housing or a linked stay.");
      if (option.attendance && option.label !== attendanceLabels[option.attendance]) issue("Review the attendance answers before sharing.");
      if (option.place && option.label !== option.place.name) issue("Review the place labels before sharing.");
      if (question.convergence && !option.exclusive && (question.convergence.dimension === "location" ? !option.place : question.convergence.dimension === "combination" ? !option.alternative : !option.schedule)) issue("Each option needs the marker for this question’s dimension.");
      if (option.partySize && option.label !== partySizeLabel(option.partySize)) issue("Review the party-size answers before sharing.");
      if (option.sleeping && option.label !== sleepingLabels[option.sleeping]) issue("Review the sleeping answers before sharing.");
      if (option.property && !option.url) issue("Add the link you were given for each place to stay.");
    }
    for (const option of question.options) if (option.alternative) {
      if (option.exclusive || option.schedule || option.housing || option.resource) issue("A date-and-place option cannot also be exclusive, scheduled, housing or a linked stay.");
      if (option.alternative.endsOn < option.alternative.startsOn) issue("The end date must be on or after the start date.");
      if (option.label !== formatAlternativeLabel(option.alternative)) issue("Review the date-and-place labels before sharing.");
    }
    const housing = question.options.flatMap(option => option.housing ? [option.housing] : []);
    if (housing.length && question.options.some(option => !option.exclusive && !option.housing)) context.addIssue({ code: "custom", message: "Add comparison details to every housing option, or mark a non-housing answer as exclusive.", path: ["questions", questionIndex] });
    if (housing.some(item => item.nights !== housing[0].nights || item.people !== housing[0].people || item.stage !== housing[0].stage || item.currency !== housing[0].currency)) {
      context.addIssue({ code: "custom", message: "Compare housing for the same nights, people, currency, and stage. Use a separate ask for final quotes.", path: ["questions", questionIndex] });
    }
    for (const option of question.options) {
      if (option.housing?.stage === "quoted" && !option.url) context.addIssue({ code: "custom", message: "Add a source link for each real housing quote.", path: ["questions", questionIndex] });
    }
    if (new Set(optionIds).size !== optionIds.length) {
      context.addIssue({ code: "custom", message: "Each answer option must be unique.", path: ["questions", questionIndex, "options"] });
    }
  }
});

// Working drafts may be incomplete. Publishing still uses the stricter schema above.
export const PollWorkingDataSchema = z.object({
  privateItineraryDocument: z.object({ id: z.string().uuid(), version: z.number().int().positive() }).strict().optional(),
  /** Organizer-only source retained for correcting extraction; never projected into publication. */
  itinerarySource: z.string().max(30000).optional(),
  presentationVersion: z.literal(2).optional(),
  lifecycle: z.object({ reopenedFromPollId: z.string().uuid().optional(), replacementDraftId: z.string().uuid().optional() }).optional(),
  communication: PollCommunicationSchema.optional(),
  settledFacts: z.string().max(1500).optional(),
  /** The organizer's private description of what needs deciding. Guides writing help only; never published or shown to participants. */
  framingRequest: z.string().max(500).optional(),
  sourcePollId: z.string().uuid().optional(),
  audience: z.object(PollAudienceSchema.shape).optional(),
  title: z.string().max(120),
  intro: z.string().max(500).nullable(),
  ballotMode: PollBallotModeSchema,
  questions: z.array(z.discriminatedUnion("kind", [
    PollChoiceQuestionSchema.extend({ prompt: z.string().max(240), options: z.array(PollOptionSchema.extend({ label: z.string().max(160), schedule: PollScheduleSchema.extend({ startsOn: z.string().max(10), endsOn: z.string().max(10), startTime: z.string().max(5), endTime: z.string().max(5) }).optional() })).max(12) }),
    PollTextQuestionSchema.extend({ prompt: z.string().max(240) }),
    PollOptionResponseQuestionSchema, PollRankingQuestionSchema, PollAllocationQuestionSchema,
  ])).max(MAX_POLL_QUESTIONS),
  review: z.object({
    messages: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(4000), at: z.string().datetime() })).max(40),
    // A single undo checkpoint. It is private and never part of a public poll.
    previous: z.object({ title: z.string().max(120), intro: z.string().max(500).nullable(), communication: PollCommunicationSchema.optional(),
      questions: z.array(PollQuestionSchema).max(MAX_POLL_QUESTIONS) }).nullable(),
    lastChange: z.string().max(1000),
  }).optional(),
});
export const SavePollDraftRequestSchema = z.object({
  id: z.string().uuid(), commandId: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative(), data: PollWorkingDataSchema,
});
export const PollWorkingDraftSchema = z.object({
  id: z.string().uuid(), version: z.number().int().positive(), data: PollWorkingDataSchema,
  publishedPollId: z.string().uuid().nullable(), archivedAt: z.string().datetime().nullable().optional(), updatedAt: z.string().datetime(),
});
export type PollWorkingData = z.infer<typeof PollWorkingDataSchema>;
export type PollWorkingDraft = z.infer<typeof PollWorkingDraftSchema>;

export const SubmitPollResponseRequestSchema = z.object({
  expectedResponseUpdatedAt: z.string().datetime().nullable().optional(),
  respondentName: z.string().trim().max(80).default(""),
  receiptToken: z.string().trim().min(24).max(200).nullable().default(null),
  newReceiptToken: z.string().trim().min(48).max(200).optional(),
  answers: z.array(PollAnswerSchema).max(MAX_POLL_QUESTIONS),
});

export const UpdatePollStatusRequestSchema = z.object({
  commandId: z.string().uuid(),
  status: z.enum(["open", "closed"]),
});

export const PollEventSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  coverImageUrl: z.string().nullable().default(null),
});

export const PollAggregateSchema = z.object({
  optionResponseCounts: z.record(z.string().uuid(), z.record(z.string(), z.number().int().nonnegative())).optional(),
  rankCounts: z.record(z.string().uuid(), z.array(z.number().int().nonnegative())).optional(),
  pointTotals: z.record(z.string().uuid(), z.number().int().nonnegative()).optional(),
  answeredCount: z.number().int().nonnegative().optional(),
  abstainedCount: z.number().int().nonnegative().optional(),
  questionId: z.string().uuid(),
  optionCounts: z.record(z.string().uuid(), z.number().int().nonnegative()),
  textResponseCount: z.number().int().nonnegative(),
});

export const PollDecisionSummarySchema = z.object({
  id: z.string().uuid(), summary: z.string(), approvedByName: z.string(),
  approvedAt: z.string().datetime(), target: z.enum(["record", "plan_idea"]),
  planId: z.string().uuid().nullable(),
  /** Organizer view only: trip stays the approved choices point to. */
  selectedStayIds: z.array(z.string().uuid()).max(20).optional(),
});

export const PublicPollSchema = z.object({
  /** What the organizer chose to tell the group, while the trip is still getting to a decision. */
  tripBrief: z.object({ welcome: z.string().nullable(), organizerName: z.string(), decideBy: z.string().nullable(), roughCost: z.string().nullable() }).nullable().optional(),
  superseded: z.object({ replacementPublicId: PollPublicIdSchema.nullable() }).nullable().optional(),
  communication: PollCommunicationSchema.nullable().optional(),
  communicationMode: z.enum(["legacy", "separated"]).default("legacy"),
  decision: PollDecisionSummarySchema.nullable().optional(),
  identityBound: z.boolean().default(false),
  authenticatedName: z.string().nullable().optional(),
  ownResponse: z.object({ respondentName: z.string(), answers: z.array(PollAnswerSchema), updatedAt: z.string().datetime() }).nullable().optional(),
  id: z.string().uuid(),
  publicId: PollPublicIdSchema,
  event: PollEventSchema,
  title: z.string().min(1),
  intro: z.string().nullable(),
  ballotMode: PollBallotModeSchema,
  status: PollStatusSchema,
  questions: z.array(PollQuestionSchema),
  createdByName: z.string().min(1),
  responseCount: z.number().int().nonnegative(),
  resultsVisible: z.boolean(),
  aggregates: z.array(PollAggregateSchema),
  createdAt: z.string().datetime(),
});

export const PollResponseSummarySchema = z.object({
  id: z.string().uuid(),
  respondentName: z.string().min(1),
  answers: z.array(PollAnswerSchema).nullable(),
  updatedAt: z.string().datetime(),
});

export const PollDetailSchema = PublicPollSchema.extend({
  evidenceFingerprint: z.string().optional(),
  audienceReview: z.object({ fingerprint: z.string(), personIds: z.array(z.string().uuid()), guestEmails: z.array(z.string()) }).nullable().optional(),
  shareToken: z.string().min(24),
  currentActorRole: z.enum(["organizer", "member"]),
  currentActorCanManage: z.boolean(),
  responses: z.array(PollResponseSummarySchema),
});

export const ApprovePollDecisionSchema = z.object({
  commandId: z.string().uuid(),
  evidenceFingerprint: z.string().length(64),
  summary: z.string().trim().min(1).max(500),
  target: z.enum(["record", "plan_idea"]),
  // An empty selection is valid only for an entirely written poll; the repository
  // checks the saved question set, not a client-supplied claim about its kind.
  selected: z.array(z.object({ questionId: z.string().uuid(), optionId: z.string().uuid() })).max(MAX_POLL_QUESTIONS),
  needResolutions: z.array(z.object({ responseId: z.string().uuid(), questionId: z.string().uuid(), resolution: z.string().trim().min(1).max(500) })).max(800),
  uncertaintyAcknowledged: z.literal(true),
  audienceExpansionApproved: z.boolean(),
});

export type ApprovePollDecision = z.infer<typeof ApprovePollDecisionSchema>;
export type PollBallotMode = z.infer<typeof PollBallotModeSchema>;
export type PollStatus = z.infer<typeof PollStatusSchema>;
export type PollPublicId = z.infer<typeof PollPublicIdSchema>;
export type PollOption = z.infer<typeof PollOptionSchema>;
export type PollQuestion = z.infer<typeof PollQuestionSchema>;
export type PollAnswer = z.infer<typeof PollAnswerSchema>;
export type CreatePollRequest = z.infer<typeof CreatePollRequestSchema>;
export type PublicPoll = z.infer<typeof PublicPollSchema>;
export type PollDetail = z.infer<typeof PollDetailSchema>;
