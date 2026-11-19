import { SetupCoordinatorStateSchema } from './coordinator-onboarding';
import { z } from "zod";

export const EventCreationSourceKindSchema = z.enum(["description", "prior_event"]);
export const EventCreationDraftStatusSchema = z.enum(["reviewing", "committed", "abandoned"]);
export const EventCreationInterpretationStatusSchema = z.enum([
  "not_required",
  "succeeded",
  "failed",
]);

/** Public acquisition identifiers only. Never put pasted plans or contacts in here, or in a URL. */
export const TripEntryContextSchema = z.object({
  template: z.string().max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  destination: z.string().max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  source: z.enum(["homepage", "template", "destination", "assistants", "guide", "organizers", "recap"]).optional(),
});

export const EventBriefSchema = z.object({
  summary: z.string().trim().max(500).nullable().default(null),
  budgetMinimumCents: z.number().int().nonnegative().nullable().default(null),
  budgetMaximumCents: z.number().int().nonnegative().nullable().default(null),
  currency: z.string().trim().length(3).nullable().default(null),
  goals: z.array(z.string().trim().min(1).max(180)).max(12).default([]),
  constraints: z.array(z.string().trim().min(1).max(180)).max(12).default([]),
  suggestedFirstMoves: z.array(z.string().trim().min(1).max(120)).max(6).default([]),
  unresolvedQuestion: z.string().trim().min(1).max(240).nullable().default(null),
}).refine(
  (value) => value.budgetMinimumCents === null
    || value.budgetMaximumCents === null
    || value.budgetMaximumCents >= value.budgetMinimumCents,
  { message: "The budget maximum must be at least the minimum.", path: ["budgetMaximumCents"] },
);

export const EventDraftInterpretationSchema = z.object({
  proposedName: z.string().trim().min(1).max(100).nullable(),
  startsOn: z.string().date().nullable(),
  endsOn: z.string().date().nullable(),
  locationName: z.string().trim().min(1).max(120).nullable(),
  eventTypeKey: z.string().trim().min(1).max(60),
  eventContextKeys: z.array(z.string().trim().min(1).max(60)).max(8),
  templateKey: z.string().trim().min(1).max(80),
  templateVersion: z.number().int().positive(),
  supported: z.boolean(),
  brief: EventBriefSchema,
  people: z.array(z.object({
    displayName: z.string().trim().min(1).max(80),
    email: z.string().trim().email().max(254).nullable().default(null),
  })).max(24).default([]),
  confidence: z.number().min(0).max(1),
});

export const EventCreationDraftPersonSchema = z.object({
  id: z.string().uuid(),
  personId: z.string().uuid().nullable(),
  displayName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(254).nullable(),
  message: z.string().trim().max(500).nullable().default(null),
  source: z.enum(["description", "prior_event", "organizer"]),
  included: z.boolean(),
  needsContact: z.boolean(),
});

export const EventCreationDraftSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  status: EventCreationDraftStatusSchema,
  sourceKind: EventCreationSourceKindSchema,
  sourceEventId: z.string().uuid().nullable(),
  sourceEventName: z.string().min(1).nullable(),
  description: z.string().max(12_000).nullable(),
  proposedName: z.string().trim().max(100).nullable(),
  startsOn: z.string().date().nullable(),
  endsOn: z.string().date().nullable(),
  locationName: z.string().trim().max(120).nullable(),
  eventTypeKey: z.string().min(1),
  eventContextKeys: z.array(z.string().min(1)),
  templateKey: z.string().min(1),
  templateVersion: z.number().int().positive(),
  supported: z.boolean(),
  brief: EventBriefSchema,
  coordinator: SetupCoordinatorStateSchema,
  interpretationStatus: EventCreationInterpretationStatusSchema,
  interpretationErrorCode: z.string().nullable(),
  people: z.array(EventCreationDraftPersonSchema).max(24),
  committedEventId: z.string().uuid().nullable(),
  committedEventSlug: z.string().nullable(),
  /** Server-set, read-only. A client can never change it. */
  betaActivationRequired: z.boolean().default(false),
  entryContext: TripEntryContextSchema.nullable().default(null),
  updatedAt: z.string().datetime(),
});

export const CreateEventCreationDraftRequestSchema = z.discriminatedUnion("sourceKind", [
  z.object({
    sourceKind: z.literal("description"),
    title: z.string().trim().min(1).max(100),
    timezone: z.string().trim().min(1).max(80),
    entryContext: TripEntryContextSchema.optional(),
  }),
  z.object({
    sourceKind: z.literal("prior_event"),
    sourceEventId: z.string().uuid(),
    timezone: z.string().trim().min(1).max(80),
    entryContext: TripEntryContextSchema.optional(),
  }),
]);

export const UpdateEventCreationDraftRequestSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    proposedName: z.string().trim().min(1).max(100),
    startsOn: z.string().date().nullable(),
    endsOn: z.string().date().nullable(),
    locationName: z.string().trim().max(120).nullable(),
    brief: EventBriefSchema,
    forceTravel: z.boolean().optional().default(false),
  })
  .refine((value) => !value.startsOn || !value.endsOn || value.endsOn >= value.startsOn, {
    message: "The event must end on or after it starts.",
    path: ["endsOn"],
  });

export const UpdateEventCreationDraftPeopleRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
  people: z.array(z.object({
    id: z.string().uuid(),
    personId: z.string().uuid().nullable(),
    displayName: z.string().trim().min(1).max(80),
    email: z.string().trim().email().max(254).nullable(),
    message: z.string().trim().max(500).nullable().default(null),
    included: z.boolean(),
  })).max(24),
});

export const CommitEventCreationDraftRequestSchema = z.object({
  commandId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  /** Activation only: create the private trip with just the organizer. People added in setup are left out and not invited. */
  privateOnly: z.boolean().optional(),
});

export const CommitEventCreationDraftResultSchema = z.object({
  eventId: z.string().uuid(),
  slug: z.string().min(1),
  coordinatorThreadId: z.string().uuid().nullable().optional(),
  unsentInvitationCount: z.number().int().nonnegative(),
  peopleNeedingContact: z.array(z.string().min(1)),
});

export const RecentReusableEventSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  startsOn: z.string().date().nullable(),
  endsOn: z.string().date().nullable(),
  locationName: z.string().nullable(),
  eventTypeKey: z.string().min(1),
  people: z.array(z.object({
    personId: z.string().uuid(),
    displayName: z.string().min(1),
    avatarUrl: z.string().nullable(),
  })).max(24),
});

export const RecentReusableEventsSchema = z.array(RecentReusableEventSchema).max(5);

export type EventBrief = z.infer<typeof EventBriefSchema>;
export type EventDraftInterpretation = z.infer<typeof EventDraftInterpretationSchema>;
export type EventCreationDraft = z.infer<typeof EventCreationDraftSchema>;
export type CreateEventCreationDraftRequest = z.infer<typeof CreateEventCreationDraftRequestSchema>;
export type UpdateEventCreationDraftRequest = z.infer<typeof UpdateEventCreationDraftRequestSchema>;
export type UpdateEventCreationDraftPeopleRequest = z.infer<typeof UpdateEventCreationDraftPeopleRequestSchema>;
export type CommitEventCreationDraftRequest = z.infer<typeof CommitEventCreationDraftRequestSchema>;
export type CommitEventCreationDraftResult = z.infer<typeof CommitEventCreationDraftResultSchema>;
export type RecentReusableEvent = z.infer<typeof RecentReusableEventSchema>;
