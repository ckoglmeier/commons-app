import { z as commonsZ } from "zod";
import { ActorSchema } from "./proposal";
import { isSupportedCurrency } from "./currencies";
import { CommonsStateSchema, MealTypeSchema, MealReservationSchema, PlacePinSchema } from "./state";
import { ConfirmationDocumentInputSchema, ConfirmationMimeTypeSchema, FlightConnectionSchema } from "./travel";

export const CommonsLocationSchema = commonsZ.object({
  name: commonsZ.string().min(1),
  address: commonsZ.string().min(1),
  latitude: commonsZ.number().min(-90).max(90).optional(),
  longitude: commonsZ.number().min(-180).max(180).optional(),
  sourceLabel: commonsZ.string().min(1),
});

/** The trip letter's trusted sections. Arranging them changes presentation only, never a date, booking, balance or permission. */
export const TRIP_LETTER_SECTION_IDS = ["welcome", "facts", "photo", "latest"] as const;
export const TripLetterSectionsSchema = commonsZ.array(commonsZ.object({
  id: commonsZ.enum(TRIP_LETTER_SECTION_IDS),
  hidden: commonsZ.boolean(),
}).strict()).length(TRIP_LETTER_SECTION_IDS.length).superRefine((sections, context) => {
  if (new Set(sections.map(section => section.id)).size !== sections.length) context.addIssue({ code: "custom", message: "Each section can appear once." });
});
export type TripLetterSections = commonsZ.infer<typeof TripLetterSectionsSchema>;

/** Each change names what the organizer last saw, so one organizer cannot silently overwrite another's newer edit. */
export const UpdateTripLetterRequestSchema = commonsZ.object({
  commandId: commonsZ.string().min(1).max(100),
  welcome: commonsZ.object({
    text: commonsZ.string().trim().max(700),
    expected: commonsZ.string().max(700).nullable(),
  }).strict().optional(),
  sections: commonsZ.object({
    value: TripLetterSectionsSchema.nullable(),
    expected: TripLetterSectionsSchema.nullable(),
  }).strict().optional(),
}).strict().refine(value => value.welcome || value.sections, { message: "Nothing to save." });

export const CommonsSummarySchema = commonsZ.object({
  id: commonsZ.string().min(1),
  slug: commonsZ.string().min(1),
  name: commonsZ.string().min(1),
  startsOn: commonsZ.string().date().nullable(),
  endsOn: commonsZ.string().date().nullable(),
  locationName: commonsZ.string().min(1).nullable(),
  locationNames: commonsZ.array(commonsZ.string().trim().min(1).max(160)).max(12).optional(),
  currency: commonsZ.string().regex(/^[A-Z]{3}$/).optional(),
  balancesDisabled: commonsZ.boolean().optional(),
  timezone: commonsZ.string().min(1),
  status: commonsZ.enum(["planning", "active", "closing", "archived"]),
  coverImageUrl: commonsZ.string().min(1).nullable(),
  coverCardImageUrl: commonsZ.string().min(1).nullable().optional(),
  coverSourceMomentId: commonsZ.string().min(1).nullable().optional(),
  lodging: CommonsLocationSchema.nullable().optional(),
  setupCompletedAt: commonsZ.string().datetime().nullable().optional(),
  firstSharedAt: commonsZ.string().datetime().nullable().optional(),
  expensesClosedAt: commonsZ.string().datetime().nullable().optional(),
  expensesClosedByPersonId: commonsZ.string().min(1).nullable().optional(),
  expensesClosedByName: commonsZ.string().min(1).nullable().optional(),
  welcomeMessage: commonsZ.string().min(1).max(700).nullable().optional(),
  welcomeAuthorPersonId: commonsZ.string().min(1).nullable().optional(),
  letterSections: TripLetterSectionsSchema.nullable().optional(),
  /** The two-stage experience, set per trip. */
  newExperience: commonsZ.boolean().optional(),
  /** Which plan template the trip started from. Null or missing means the trip template. */
  templateKey: commonsZ.string().min(1).nullable().optional(),
  /** "deciding" until the organizer says "We're going". Trips on the older experience are always "going". */
  stage: commonsZ.enum(["deciding", "going"]).optional(),
});

export const CommonsParticipantSchema = commonsZ.object({
  id: commonsZ.string().min(1),
  displayName: commonsZ.string().min(1),
  initials: commonsZ.string().min(1).max(3),
  role: commonsZ.enum(["organizer", "member"]),
  membershipStatus: commonsZ.enum(["invited", "active"]),
  accessMode: commonsZ.enum(["account", "managed"]).optional(),
  managedByPersonIds: commonsZ.array(commonsZ.string().min(1)).min(1).optional(),
  canClaimAccess: commonsZ.boolean().optional(),
  avatarUrl: commonsZ.string().min(1).nullable(),
  expensesCompleteAt: commonsZ.string().datetime().nullable().optional(),
  sharedPreferences: commonsZ.object({
    usualOriginLabel: commonsZ.string().nullable().optional(),
    dietaryPreferences: commonsZ.string().nullable().optional(),
    accessibilityNeeds: commonsZ.string().nullable().optional(),
    lodgingPreferences: commonsZ.string().nullable().optional(),
    transportationPreferences: commonsZ.string().nullable().optional(),
  }).optional(),
}).superRefine((participant, context) => {
  if (participant.accessMode === "managed" && !participant.managedByPersonIds?.length) {
    context.addIssue({
      code: "custom",
      message: "A managed traveler must name at least one person who can act for them.",
      path: ["managedByPersonIds"],
    });
  }
  if (participant.accessMode === "account" && participant.canClaimAccess) {
    context.addIssue({
      code: "custom",
      message: "Only a managed traveler can have claimable access.",
      path: ["canClaimAccess"],
    });
  }
});

export const CommonsSnapshotSchema = commonsZ.object({
  commons: CommonsSummarySchema,
  currentActor: ActorSchema,
  participants: commonsZ.array(CommonsParticipantSchema),
  state: CommonsStateSchema,
});

export const CommonsMembershipSummarySchema = commonsZ.object({
  commons: CommonsSummarySchema,
  role: commonsZ.enum(["organizer", "member"]),
  participantCount: commonsZ.number().int().nonnegative(),
});

export const AppendMessageCommandSchema = commonsZ.object({
  commandId: commonsZ.string().min(1),
  body: commonsZ.string().trim().min(1).max(4_000),
  occurredAt: commonsZ.string().datetime(),
});

export const UpsertTravelPlanCommandSchema = commonsZ.object({
  commandId: commonsZ.string().min(1),
  travelPlanId: commonsZ.string().uuid().nullable().default(null),
  kind: commonsZ.enum(["arrival", "departure", "car_rental", "transport"]),
  date: commonsZ.string().date(),
  route: commonsZ.string().trim().min(1).max(120),
  time: commonsZ.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  note: commonsZ.string().trim().max(120),
  companionPersonId: commonsZ.string().min(1).nullable(),
  includedPersonIds: commonsZ.array(commonsZ.string().min(1)).max(30).default([]),
  driverPersonId: commonsZ.string().min(1).nullable().default(null),
  provider: commonsZ.string().trim().max(120).nullable().default(null),
  vehicle: commonsZ.string().trim().max(120).nullable().default(null),
  returnDate: commonsZ.string().date().nullable().default(null),
  returnTime: commonsZ.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().default(null),
  status: commonsZ.enum(["considering", "booked", "confirmed"]).default("confirmed"),
  confirmationCode: commonsZ.string().trim().max(120).nullable().default(null),
  totalCents: commonsZ.number().int().positive().max(100_000_000).nullable().default(null),
  currency: commonsZ.string().trim().regex(/^[A-Z]{3}$/).default("USD"),
  confirmationDocument: ConfirmationDocumentInputSchema.optional(),
}).superRefine((value, context) => {
  if (["arrival", "departure"].includes(value.kind) && value.time === null) {
    context.addIssue({
      code: "custom",
      message: "Add a time for an arrival or departure plan.",
      path: ["time"],
    });
  }
});

const FlightBookingLegSchema = commonsZ.object({
  kind: commonsZ.enum(["arrival", "departure"]),
  date: commonsZ.string().date(),
  route: commonsZ.string().trim().min(1).max(120),
  time: commonsZ.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  connections: commonsZ.array(FlightConnectionSchema).max(8).optional(),
}).superRefine((leg, context) => {
  if (!leg.connections?.length) return;
  const first = leg.connections[0], last = leg.connections.at(-1)!;
  const date = leg.kind === "arrival" ? last.arrivalDate : first.departureDate;
  const time = leg.kind === "arrival" ? last.arrivalTime : first.departureTime;
  const route = [first.origin, ...leg.connections.map(item => item.destination)].filter(Boolean).join(" → ").slice(0, 120);
  if (date !== leg.date || time !== leg.time || route !== leg.route) context.addIssue({ code: "custom", message: "Review the flight endpoints. The coordination summary must match the itinerary.", path: ["connections"] });
});

export const UpsertFlightBookingCommandSchema = commonsZ.object({
  commandId: commonsZ.string().uuid(),
  legs: commonsZ.array(FlightBookingLegSchema).min(1).max(2),
  expectedPlanVersions: commonsZ.array(commonsZ.object({ id: commonsZ.string().uuid(), version: commonsZ.string() })).max(2).optional(),
  removeLegKinds: commonsZ.array(commonsZ.enum(["arrival", "departure"])).max(1).default([]),
  includedPersonIds: commonsZ.array(commonsZ.string().min(1)).min(1).max(30),
  note: commonsZ.string().trim().max(120),
  confirmationCode: commonsZ.string().trim().max(120).nullable().default(null),
  totalCents: commonsZ.number().int().positive().max(100_000_000).nullable().default(null),
  currency: commonsZ.string().trim().regex(/^[A-Z]{3}$/).default("USD"),
  confirmationDocument: ConfirmationDocumentInputSchema.optional(),
}).superRefine((value, context) => {
  if (new Set(value.legs.map((leg) => leg.kind)).size !== value.legs.length) {
    context.addIssue({ code: "custom", message: "Include no more than one flight there and one flight home.", path: ["legs"] });
  }
  if (value.removeLegKinds.some((kind) => value.legs.some((leg) => leg.kind === kind))) {
    context.addIssue({ code: "custom", message: "A flight cannot be saved and removed together.", path: ["removeLegKinds"] });
  }
});

export const ConfirmationDraftSchema = commonsZ.object({
  kind: commonsZ.enum(["stay", "flight", "car_rental"]),
  sourceLabel: commonsZ.string().trim().min(1).max(180),
  name: commonsZ.string().trim().max(160).nullable(),
  address: commonsZ.string().trim().max(240).nullable(),
  startsOn: commonsZ.string().date().nullable(),
  endsOn: commonsZ.string().date().nullable(),
  startTime: commonsZ.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  endTime: commonsZ.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  route: commonsZ.string().trim().max(120).nullable(),
  note: commonsZ.string().trim().max(120).nullable(),
  confirmationCode: commonsZ.string().trim().max(120).nullable(),
  totalCents: commonsZ.number().int().positive().max(100_000_000).nullable(),
  currency: commonsZ.string().trim().regex(/^[A-Z]{3}$/),
  includesTaxesAndFees: commonsZ.boolean().nullable(),
  travelerNames: commonsZ.array(commonsZ.string().trim().min(1).max(100)).max(30).optional(),
  travelSegments: commonsZ.array(commonsZ.object({
    kind: commonsZ.enum(["arrival", "departure"]),
    date: commonsZ.string().date().nullable(),
    route: commonsZ.string().trim().max(120).nullable(),
    time: commonsZ.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
    departureTime: commonsZ.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
    arrivalTime: commonsZ.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
    connections: commonsZ.array(FlightConnectionSchema).max(8).optional(),
  })).max(8).optional(),
  warnings: commonsZ.array(commonsZ.string().trim().min(1).max(180)).max(8),
});

export const ConfirmationPreviewResponseSchema = commonsZ.object({
  intakeId: commonsZ.string().uuid().optional(),
  intakeVersion: commonsZ.number().int().positive().optional(),
  alreadyUploaded: commonsZ.boolean().optional(),
  draft: ConfirmationDraftSchema,
  upload: commonsZ.object({
    storagePath: commonsZ.string().trim().min(1).max(500),
    token: commonsZ.string().min(1),
    mimeType: ConfirmationMimeTypeSchema.optional(),
  }),
});

export const UpdateTravelPlanSharingCommandSchema = commonsZ.object({
  commandId: commonsZ.string().min(1),
  travelPlanId: commonsZ.string().uuid(),
  visibility: commonsZ.enum(["private", "basic", "all"]),
  expectedVersion: commonsZ.string().optional(),
});

export const DeleteTravelPlanCommandSchema = commonsZ.object({
  commandId: commonsZ.string().uuid(),
  travelPlanId: commonsZ.string().uuid(),
});

export const UpdateCommonsCoverRequestSchema = commonsZ.object({
  commandId: commonsZ.string().uuid(),
  originalStoragePath: commonsZ.string().min(1).max(500),
  cardStoragePath: commonsZ.string().min(1).max(500),
  mimeType: commonsZ.enum(["image/jpeg", "image/png", "image/webp"]),
  sourceMomentId: commonsZ.string().uuid().nullable(),
});

export const UpdateCommonsArchiveRequestSchema = commonsZ.object({
  commandId: commonsZ.string().min(1),
  archived: commonsZ.boolean(),
});

export const UpdateCommonsTitleRequestSchema = commonsZ.object({
  commandId: commonsZ.string().min(1),
  title: commonsZ.string().trim().min(1).max(100),
});

export const UpdateCommonsDetailsRequestSchema = commonsZ.object({
  currency: commonsZ.string().refine(isSupportedCurrency, "Choose a supported currency.").optional(),
  expectedCurrency: commonsZ.string().regex(/^[A-Z]{3}$/).optional(),
  timezone: commonsZ.string().max(80).refine(value => { try { new Intl.DateTimeFormat("en", {timeZone:value}); return true; } catch { return false; } }, "Use a valid timezone.").optional(),
  commandId: commonsZ.string().uuid(),
  title: commonsZ.string().trim().min(1).max(100),
  startsOn: commonsZ.string().date().nullable(),
  endsOn: commonsZ.string().date().nullable(),
  locationName: commonsZ.string().trim().max(160).nullable(),
  locationNames: commonsZ.array(commonsZ.string().trim().min(1).max(160)).max(12).default([]),
  balancesDisabled: commonsZ.boolean().default(false),
}).superRefine((value, context) => {
  if (value.currency !== undefined && value.expectedCurrency === undefined) {
    context.addIssue({ code: "custom", message: "Reload the trip before changing its currency.", path: ["expectedCurrency"] });
  }
  if (value.startsOn && value.endsOn && value.endsOn < value.startsOn) {
    context.addIssue({
      code: "custom",
      message: "The end date must be on or after the start date.",
      path: ["endsOn"],
    });
  }
});

const StayFieldsSchema = commonsZ.object({
  name: commonsZ.string().trim().min(1).max(160),
  address: commonsZ.string().trim().max(240).default(""),
  // Omitted on update keeps the saved pin; null removes it.
  pin: PlacePinSchema.nullable().optional(),
  startsOn: commonsZ.string().date(),
  endsOn: commonsZ.string().date(),
  timezone: commonsZ.string().max(64).refine(value => {try {new Intl.DateTimeFormat("en-US", {timeZone:value});return true;} catch {return false;}}, "Choose a valid timezone.").nullable().default(null),
  checkInTime: commonsZ.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().default(null),
  checkOutTime: commonsZ.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().default(null),
  status: commonsZ.enum(["considering", "planned", "confirmed"]),
  includedPersonIds: commonsZ.array(commonsZ.string().uuid()).min(1).max(100),
  bookingUrl: commonsZ.string().trim().url().max(2_048).nullable().default(null),
  pollId: commonsZ.string().uuid().nullable().default(null),
  confirmationCode: commonsZ.string().trim().max(120).nullable().default(null),
  totalCents: commonsZ.number().int().positive().max(100_000_000).nullable().default(null),
  // Omitted on update keeps the saved value; null removes it.
  roomPriceCents: commonsZ.number().int().positive().max(100_000_000).nullable().optional(),
  roomCount: commonsZ.number().int().min(1).max(50).nullable().optional(),
  currency: commonsZ.string().trim().regex(/^[A-Z]{3}$/).default("USD"),
  costSource: commonsZ.enum(["estimate", "confirmation", "expense"]).nullable().default(null),
  includesTaxesAndFees: commonsZ.boolean().nullable().default(null),
  details: commonsZ.string().trim().max(1_000).nullable().default(null),
  confirmationDocument: ConfirmationDocumentInputSchema.optional(),
}).superRefine((value, context) => {
  if (!value.address && value.status !== "considering") {
    context.addIssue({ code: "custom", message: "Add the stay's address.", path: ["address"] });
  }
  if (value.endsOn < value.startsOn) {
    context.addIssue({
      code: "custom",
      message: "Check-out must be on or after check-in.",
      path: ["endsOn"],
    });
  }
  if (new Set(value.includedPersonIds).size !== value.includedPersonIds.length) {
    context.addIssue({
      code: "custom",
      message: "Each traveler can be included only once.",
      path: ["includedPersonIds"],
    });
  }
  if (value.totalCents !== null && value.costSource === null) {
    context.addIssue({
      code: "custom",
      message: "Choose where the stay cost came from.",
      path: ["costSource"],
    });
  }
  // A per-room quote may say whether taxes are included before any group total exists.
  // When a request omits the room price, the saved price decides (the database checks it).
  if (value.totalCents === null && (value.costSource !== null || (value.includesTaxesAndFees !== null && value.roomPriceCents === null))) {
    context.addIssue({
      code: "custom",
      message: "Add a stay cost before describing it.",
      path: ["totalCents"],
    });
  }
});

export const AddStayCommandSchema = StayFieldsSchema.extend({
  commandId: commonsZ.string().uuid(),
});

export const UpdateStayCommandSchema = StayFieldsSchema.extend({
  commandId: commonsZ.string().uuid(),
});

/** Places or removes only a stay's or activity's map pin. */
export const SetPlacePinCommandSchema = commonsZ.object({
  commandId: commonsZ.string().uuid(),
  kind: commonsZ.enum(["stay", "activity"]),
  id: commonsZ.string().uuid(),
  pin: PlacePinSchema.nullable(),
}).strict();

export const DeleteStayCommandSchema = commonsZ.object({
  commandId: commonsZ.string().uuid(),
});

export const UpdateMomentRequestSchema = commonsZ.object({
  commandId: commonsZ.string().min(1),
  caption: commonsZ.string().trim().min(1).max(160),
  occurredOn: commonsZ.string().date().nullable(),
  itineraryItemId: commonsZ.string().min(1).nullable(),
});

export const DeleteMomentRequestSchema = commonsZ.object({
  commandId: commonsZ.string().min(1),
});

export const AddExpenseCommandSchema = commonsZ
  .object({
    commandId: commonsZ.string().min(1),
    title: commonsZ.string().trim().min(1).max(120),
    currency: commonsZ.string().regex(/^[A-Z]{3}$/).optional(),
    amountCents: commonsZ.number().int().positive().max(10_000_000),
    paidByPersonId: commonsZ.string().min(1),
    occurredOn: commonsZ.string().date(),
    category: commonsZ.string().trim().min(1).max(60),
    itineraryItemId: commonsZ.string().min(1).nullable().default(null),
    stayId: commonsZ.string().uuid().nullable().default(null),
    travelPlanId: commonsZ.string().uuid().nullable().default(null),
    splitMethod: commonsZ.enum(["equal", "exact"]),
    balanceMode: commonsZ.enum(["allocated", "tracking_only", "budget_only"]).default("allocated"),
    confirmationCode: commonsZ.string().trim().max(120).nullable().default(null),
    shares: commonsZ.array(commonsZ.object({
      personId: commonsZ.string().min(1),
      amountCents: commonsZ.number().int().nonnegative(),
    })).min(1).max(100),
    note: commonsZ.string().trim().max(500).optional(),
  })
  .superRefine((value, context) => {
    const includedIds = value.shares.map((share) => share.personId);
    if (new Set(includedIds).size !== includedIds.length) {
      context.addIssue({
        code: "custom",
        message: "Each participant can be included only once.",
        path: ["shares"],
      });
    }
    const allocatedCents = value.shares.reduce(
      (sum, share) => sum + share.amountCents,
      0,
    );
    const expectedAllocation = value.balanceMode === "allocated" ? value.amountCents : 0;
    if (allocatedCents !== expectedAllocation) {
      context.addIssue({
        code: "custom",
        message: value.balanceMode !== "allocated"
          ? "An expense without allocations cannot create participant balances."
          : "The participant shares must add up to the expense total.",
        path: ["shares"],
      });
    }
  });

export const UpdateExpenseCommandSchema = AddExpenseCommandSchema;

export const DeleteExpenseCommandSchema = commonsZ.object({
  commandId: commonsZ.string().min(1),
});

export const AddReimbursementCommandSchema = commonsZ
  .object({
    commandId: commonsZ.string().min(1),
    fromPersonId: commonsZ.string().min(1),
    toPersonId: commonsZ.string().min(1),
    currency: commonsZ.string().regex(/^[A-Z]{3}$/).optional(),
    amountCents: commonsZ.number().int().positive().max(10_000_000),
    occurredOn: commonsZ.string().date(),
  })
  .refine((value) => value.fromPersonId !== value.toPersonId, {
    message: "A payment must be between two different people.",
    path: ["toPersonId"],
  });

export const UpdateReimbursementCommandSchema = AddReimbursementCommandSchema;

export const DeleteReimbursementCommandSchema = commonsZ.object({
  commandId: commonsZ.string().min(1),
});

export const ConfirmExpensesCompleteCommandSchema = commonsZ.object({
  commandId: commonsZ.string().min(1),
  scope: commonsZ.enum(["self", "group"]).default("self"),
});

export const ReopenExpensesCommandSchema = commonsZ.object({
  commandId: commonsZ.string().min(1),
});

export const UpdateTargetBudgetCommandSchema = commonsZ.object({
  currency: commonsZ.string().regex(/^[A-Z]{3}$/).optional(),
  commandId: commonsZ.string().min(1),
  amountCents: commonsZ.number().int().positive().max(100_000_000).nullable(),
});

const ItineraryItemCommandFields = {
  mealType: MealTypeSchema.nullable().optional(),
  mealReservation: MealReservationSchema.nullable().optional(),
  commandId: commonsZ.string().min(1),
  title: commonsZ.string().trim().min(1).max(120),
  status: commonsZ.enum(["idea", "planned", "confirmed", "cancelled"]).optional(),
  date: commonsZ.string().date().nullable(),
  time: commonsZ.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  durationMinutes: commonsZ.number().int().positive().max(10080).nullable().optional(),
  location: commonsZ.string().trim().max(160).optional(),
  // Omitted on update keeps the saved pin; null removes it.
  pin: PlacePinSchema.nullable().optional(),
  participantScope: commonsZ.enum(["everyone", "subgroup", "optional", "self"]),
  expectedCostCurrency: commonsZ.string().regex(/^[A-Z]{3}$/).optional(),
  expectedCostCents: commonsZ.number().int().positive().max(10_000_000).nullable().default(null),
  expectedCostBasis: commonsZ.enum(["total", "per_person"]).default("total"),
  expectedParticipantIds: commonsZ.array(commonsZ.string().min(1)).max(100).default([]),
  note: commonsZ.string().trim().max(500).optional(),
  sourceUrl: commonsZ.string().url().max(2_048).refine(
    (value) => value.startsWith("https://") || value.startsWith("http://"),
    "Source links must use http or https.",
  ).nullable().optional(),
  occurredAt: commonsZ.string().datetime(),
};

const validateItineraryTiming = (
  value: { date: string | null; time: string | null; participantScope: string; expectedCostCents: number | null; expectedCostBasis: "total" | "per_person"; expectedParticipantIds: string[] },
  context: commonsZ.RefinementCtx,
) => {
  if (value.participantScope === "subgroup" && value.expectedParticipantIds.length === 0) {
    context.addIssue({ code: commonsZ.ZodIssueCode.custom, path: ["expectedParticipantIds"], message: "Choose at least one person for this plan." });
  }
  if (value.date === null && value.time !== null) {
    context.addIssue({
      code: commonsZ.ZodIssueCode.custom,
      message: "Choose a day before adding a time.",
      path: value.date === null ? ["date"] : ["time"],
    });
  }
  if (value.participantScope !== "self" && value.expectedCostCents && value.expectedCostBasis === "per_person" && value.expectedParticipantIds.length === 0) {
    context.addIssue({
      code: commonsZ.ZodIssueCode.custom,
      message: "Choose at least one expected traveler for a per-person estimate.",
      path: ["expectedParticipantIds"],
    });
  }
};

export const AddItineraryItemCommandSchema = commonsZ.object({
  ...ItineraryItemCommandFields,
  arrangerPersonId: commonsZ.string().uuid().nullable().optional(),
}).superRefine(validateItineraryTiming);
export const UpdateItineraryItemCommandSchema = commonsZ.object({
  ...ItineraryItemCommandFields,
  arrangerPersonId: commonsZ.string().uuid().nullable().optional(),
  expectedArrangerPersonId: commonsZ.string().uuid().nullable().optional(),
}).superRefine(validateItineraryTiming).superRefine((value, context) => {
  if (value.arrangerPersonId !== undefined && value.expectedArrangerPersonId === undefined) {
    context.addIssue({ code: commonsZ.ZodIssueCode.custom, path: ["expectedArrangerPersonId"], message: "Review the current arranger before changing it." });
  }
});

export const DeleteItineraryItemCommandSchema = commonsZ.object({
  commandId: commonsZ.string().min(1),
  occurredAt: commonsZ.string().datetime(),
});

export const UpdateParticipationCommandSchema = commonsZ.object({
  commandId: commonsZ.string().min(1),
  response: commonsZ.enum(["in", "maybe", "skip"]),
  occurredAt: commonsZ.string().datetime(),
});

export const AddMomentCommandSchema = commonsZ.object({
  commandId: commonsZ.string().min(1),
  id: commonsZ.string().uuid(),
  storagePath: commonsZ.string().trim().min(1).max(500),
  mimeType: commonsZ.enum(["image/jpeg", "image/png", "image/webp"]),
  caption: commonsZ.string().trim().min(1).max(160),
  altText: commonsZ.string().trim().min(1).max(500),
  occurredAt: commonsZ.string().datetime(),
  dateStatus: commonsZ.enum(["confirmed", "unconfirmed"]),
  itineraryItemId: commonsZ.string().min(1).nullable(),
  eventMatchSource: commonsZ.enum(["automatic", "manual"]).nullable(),
  eventMatchConfidence: commonsZ.number().int().min(0).max(100).nullable(),
  eventMatchReason: commonsZ.string().trim().max(500).nullable(),
});

export const ImportedItineraryItemSchema = commonsZ.object({
  title: commonsZ.string().trim().min(1).max(160),
  date: commonsZ.string().date(),
  time: commonsZ.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  location: commonsZ.string().trim().max(160).optional(),
  participantScope: commonsZ.enum(["everyone", "subgroup", "optional"]),
  sourceLabel: commonsZ.string().trim().min(1).max(240),
});

export const PlanImportSourceKindSchema = commonsZ.enum([
  "pdf",
  "word_document",
  "spreadsheet",
  "email_export",
  "pasted_notes",
  "text_file",
]);

export const PlanImportPreviewItemSchema = ImportedItineraryItemSchema.extend({
  id: commonsZ.string().min(1),
  sourceExcerpt: commonsZ.string().trim().min(1).max(500),
  needsReview: commonsZ.boolean(),
});

export const PlanImportPreviewSchema = commonsZ.object({
  sourceKind: PlanImportSourceKindSchema,
  sourceLabel: commonsZ.string().trim().min(1).max(240),
  items: commonsZ.array(PlanImportPreviewItemSchema).max(60),
  warnings: commonsZ.array(commonsZ.string().min(1).max(240)).max(10),
});

export const CreateCommonsRequestSchema = commonsZ
  .object({
    organizerDisplayName: commonsZ.string().trim().min(1).max(80),
    name: commonsZ.string().trim().min(2).max(100),
    startsOn: commonsZ.string().date(),
    endsOn: commonsZ.string().date(),
    locationName: commonsZ.string().trim().min(1).max(120),
    timezone: commonsZ.string().trim().min(1).max(80),
    participantNames: commonsZ
      .array(commonsZ.string().trim().min(1).max(80))
      .max(24),
    importedItinerary: commonsZ.array(ImportedItineraryItemSchema).max(60).default([]),
  })
  .refine((value) => value.endsOn >= value.startsOn, {
    message: "The trip must end on or after it starts.",
    path: ["endsOn"],
  })
  .refine(
    (value) =>
      new Date(`${value.endsOn}T12:00:00Z`).valueOf() -
        new Date(`${value.startsOn}T12:00:00Z`).valueOf() <=
      30 * 86_400_000,
    {
      message: "Trips can be up to 31 days.",
      path: ["endsOn"],
    },
  );

export const CommonsInvitationSchema = commonsZ.object({
  id: commonsZ.string().min(1),
  recipientName: commonsZ.string().min(1),
  token: commonsZ.string().min(20),
  expiresAt: commonsZ.string().datetime().nullable(),
});

export const CreateCommonsResultSchema = commonsZ.object({
  commonsId: commonsZ.string().min(1),
  slug: commonsZ.string().min(1),
  invitations: commonsZ.array(CommonsInvitationSchema),
});

export const CreateCommonsDraftRequestSchema = commonsZ
  .object({
    organizerDisplayName: commonsZ.string().trim().min(1).max(80),
    name: commonsZ.string().trim().min(2).max(100),
    startsOn: commonsZ.string().date(),
    endsOn: commonsZ.string().date(),
    locationName: commonsZ.string().trim().min(1).max(120),
    timezone: commonsZ.string().trim().min(1).max(80),
  })
  .refine((value) => value.endsOn >= value.startsOn, {
    message: "The trip must end on or after it starts.",
    path: ["endsOn"],
  })
  .refine(
    (value) =>
      new Date(`${value.endsOn}T12:00:00Z`).valueOf() -
        new Date(`${value.startsOn}T12:00:00Z`).valueOf() <=
      30 * 86_400_000,
    {
      message: "Trips can be up to 31 days.",
      path: ["endsOn"],
    },
  );

export const CreateCommonsDraftResultSchema = commonsZ.object({
  commonsId: commonsZ.string().min(1),
  slug: commonsZ.string().min(1),
});

export const SetupTravelerInputSchema = commonsZ.object({
  displayName: commonsZ.string().trim().min(1).max(80),
  email: commonsZ.string().trim().email().max(254),
});

export const SaveSetupTravelersRequestSchema = commonsZ.object({
  travelers: commonsZ.array(SetupTravelerInputSchema).max(24),
});

export const SetupTravelerSchema = SetupTravelerInputSchema.extend({
  invitationId: commonsZ.string().min(1),
  invitationStatus: commonsZ.enum(["pending", "accepted", "revoked", "expired"]),
  deliveryState: commonsZ.enum(["not_sent", "queued", "sent", "failed"]),
});

export const CommonsPersonInvitationSchema = commonsZ.object({
  id: commonsZ.string().min(1),
  status: commonsZ.enum(["pending", "accepted", "revoked", "expired"]),
  deliveryState: commonsZ.enum(["not_sent", "queued", "sent", "failed"]),
  deliveryErrorCode: commonsZ.string().nullable(),
  message: commonsZ.string().max(500).nullable(),
  sentAt: commonsZ.string().datetime().nullable(),
  lastAttemptAt: commonsZ.string().datetime().nullable(),
  expiresAt: commonsZ.string().datetime().nullable(),
});

export const CommonsPersonSchema = commonsZ.object({
  membershipId: commonsZ.string().min(1),
  personId: commonsZ.string().min(1),
  displayName: commonsZ.string().min(1),
  email: commonsZ.string().email().nullable(),
  role: commonsZ.enum(["organizer", "member"]),
  membershipStatus: commonsZ.enum(["invited", "active", "left", "removed"]),
  joinedAt: commonsZ.string().datetime().nullable(),
  accessMode: commonsZ.enum(["account", "managed"]),
  managedByPersonIds: commonsZ.array(commonsZ.string().min(1)).nullable(),
  canClaimAccess: commonsZ.boolean(),
  invitation: CommonsPersonInvitationSchema.nullable(),
  removal: commonsZ.object({
    blocked: commonsZ.boolean(),
    moneyItems: commonsZ.number().int().nonnegative(),
    responsibilityItems: commonsZ.number().int().nonnegative(),
  }),
});

export const CommonsPeopleSchema = commonsZ.object({
  commons: CommonsSummarySchema,
  organizerName: commonsZ.string().min(1),
  currentPersonId: commonsZ.string().min(1),
  people: commonsZ.array(CommonsPersonSchema),
});

const TravelerProfileAttributionSchema = commonsZ.object({
  personId: commonsZ.string().min(1),
  displayName: commonsZ.string().min(1),
}).nullable();

export const TravelerProfileSchema = commonsZ.object({
  personId: commonsZ.string().min(1),
  displayName: commonsZ.string().min(1),
  usualOriginLabel: commonsZ.string().nullable(),
  dietaryPreferences: commonsZ.string().nullable(),
  accessibilityNeeds: commonsZ.string().nullable(),
  lodgingPreferences: commonsZ.string().nullable(),
  transportationPreferences: commonsZ.string().nullable(),
  suppliedBy: commonsZ.object({
    usualOriginLabel: TravelerProfileAttributionSchema,
    dietaryPreferences: TravelerProfileAttributionSchema,
    accessibilityNeeds: TravelerProfileAttributionSchema,
    lodgingPreferences: TravelerProfileAttributionSchema,
    transportationPreferences: TravelerProfileAttributionSchema,
  }),
  dailyDigestEnabled: commonsZ.boolean(),
  sharedPreferenceKeys: commonsZ.array(commonsZ.enum(["usualOriginLabel", "dietaryPreferences", "accessibilityNeeds", "lodgingPreferences", "transportationPreferences"])).optional(),
});

export const UpdateTravelerProfileRequestSchema = commonsZ.object({
  usualOriginLabel: commonsZ.string().trim().max(160).nullable().optional(),
  dietaryPreferences: commonsZ.string().trim().max(500).nullable().optional(),
  accessibilityNeeds: commonsZ.string().trim().max(500).nullable().optional(),
  lodgingPreferences: commonsZ.string().trim().max(500).nullable().optional(),
  transportationPreferences: commonsZ.string().trim().max(500).nullable().optional(),
  dailyDigestEnabled: commonsZ.boolean().optional(),
  sharedPreferenceKeys: commonsZ.array(commonsZ.enum(["usualOriginLabel", "dietaryPreferences", "accessibilityNeeds", "lodgingPreferences", "transportationPreferences"])).max(5).optional(),
}).refine((value) => Object.keys(value).length > 0, "Choose a profile detail to update.");

const OptionalInvitationMessageSchema = commonsZ.string().trim().max(500).nullable().optional().default(null);
export const AddCommonsPersonRequestSchema = commonsZ.object({
  displayName: commonsZ.string().trim().min(1).max(80),
  role: commonsZ.enum(["member", "organizer"]).default("member"),
  email: commonsZ.string().trim().email().max(254).nullable().default(null),
  accessMode: commonsZ.enum(["account", "managed"]).default("account"),
  canClaimAccess: commonsZ.boolean().default(false),
  message: OptionalInvitationMessageSchema,
}).superRefine((value, context) => {
  if (value.accessMode === "managed" && value.role === "organizer") {
    context.addIssue({ code: "custom", message: "An organizer needs their own account.", path: ["role"] });
  }
  if (value.accessMode === "account" && !value.email) {
    context.addIssue({ code: "custom", message: "Email is required for an account traveler.", path: ["email"] });
  }
  if (value.accessMode === "managed" && value.email) {
    context.addIssue({ code: "custom", message: "A managed traveler does not need an email.", path: ["email"] });
  }
});
export const UpdateCommonsInvitationRequestSchema = SetupTravelerInputSchema.extend({ message: OptionalInvitationMessageSchema });
export const UpdateCommonsPersonRoleRequestSchema = commonsZ.object({
  role: commonsZ.enum(["organizer", "member"]),
});

export const InvitationLinkSchema = commonsZ.object({
  invitationId: commonsZ.string().min(1),
  url: commonsZ.string().url(),
  expiresAt: commonsZ.string().datetime().nullable(),
});

export const InvitationDeliveryActionSchema = commonsZ.object({
  invitationId: commonsZ.string().min(1),
  deliveryState: commonsZ.enum(["queued", "sent", "failed"]),
  deliveryErrorCode: commonsZ.string().nullable(),
});

export const CommonsSetupSchema = commonsZ.object({
  commons: CommonsSummarySchema,
  organizerName: commonsZ.string().min(1),
  travelers: commonsZ.array(SetupTravelerSchema),
  importedPlanCount: commonsZ.number().int().nonnegative(),
});

export const CommitSetupImportRequestSchema = commonsZ.object({
  commandId: commonsZ.string().min(1),
  items: commonsZ.array(ImportedItineraryItemSchema).max(60),
});

export const InvitationDeliverySchema = commonsZ.object({
  invitationId: commonsZ.string().min(1),
  recipientName: commonsZ.string().min(1),
  recipientEmail: commonsZ.string().email(),
  deliveryState: commonsZ.enum(["sent", "failed"]),
  token: commonsZ.string().min(20).optional(),
});

export const SendSetupInvitationsResultSchema = commonsZ.object({
  deliveries: commonsZ.array(InvitationDeliverySchema),
});

export const InvitationPreviewSchema = commonsZ.object({
  managedTraveler: commonsZ.boolean().default(false),
  commonsId: commonsZ.string().min(1),
  commonsSlug: commonsZ.string().min(1),
  commonsName: commonsZ.string().min(1),
  startsOn: commonsZ.string().date().nullable(),
  endsOn: commonsZ.string().date().nullable(),
  locationName: commonsZ.string().nullable(),
  coverImageUrl: commonsZ.string().nullable(),
  inviterName: commonsZ.string().min(1),
  recipientName: commonsZ.string().min(1),
  status: commonsZ.enum(["pending", "accepted", "revoked", "expired"]),
  expiresAt: commonsZ.string().datetime().nullable(),
});

export type CommonsSummary = commonsZ.infer<typeof CommonsSummarySchema>;
export type CommonsLocation = commonsZ.infer<typeof CommonsLocationSchema>;
export type CommonsParticipant = commonsZ.infer<typeof CommonsParticipantSchema>;
export type CommonsSnapshot = commonsZ.infer<typeof CommonsSnapshotSchema>;
export type CommonsMembershipSummary = commonsZ.infer<
  typeof CommonsMembershipSummarySchema
>;
export type AppendMessageCommand = commonsZ.infer<typeof AppendMessageCommandSchema>;
export type UpsertTravelPlanCommand = commonsZ.infer<typeof UpsertTravelPlanCommandSchema>;
export type UpsertFlightBookingCommand = commonsZ.infer<typeof UpsertFlightBookingCommandSchema>;
export type ConfirmationDraft = commonsZ.infer<typeof ConfirmationDraftSchema>;
export type ConfirmationPreviewResponse = commonsZ.infer<typeof ConfirmationPreviewResponseSchema>;
export type UpdateTravelPlanSharingCommand = commonsZ.infer<typeof UpdateTravelPlanSharingCommandSchema>;
export type DeleteTravelPlanCommand = commonsZ.infer<typeof DeleteTravelPlanCommandSchema>;
export type UpdateTargetBudgetCommand = commonsZ.infer<typeof UpdateTargetBudgetCommandSchema>;
export type UpdateCommonsCoverRequest = commonsZ.infer<typeof UpdateCommonsCoverRequestSchema>;
export type UpdateCommonsArchiveRequest = commonsZ.infer<typeof UpdateCommonsArchiveRequestSchema>;
export type UpdateCommonsTitleRequest = commonsZ.infer<typeof UpdateCommonsTitleRequestSchema>;
export type UpdateCommonsDetailsRequest = commonsZ.infer<typeof UpdateCommonsDetailsRequestSchema>;
export type AddStayCommand = commonsZ.infer<typeof AddStayCommandSchema>;
export type UpdateStayCommand = commonsZ.infer<typeof UpdateStayCommandSchema>;
export type DeleteStayCommand = commonsZ.infer<typeof DeleteStayCommandSchema>;
export type UpdateMomentRequest = commonsZ.infer<typeof UpdateMomentRequestSchema>;
export type DeleteMomentRequest = commonsZ.infer<typeof DeleteMomentRequestSchema>;
export type AddExpenseCommand = commonsZ.infer<typeof AddExpenseCommandSchema>;
export type UpdateExpenseCommand = commonsZ.infer<typeof UpdateExpenseCommandSchema>;
export type DeleteExpenseCommand = commonsZ.infer<typeof DeleteExpenseCommandSchema>;
export type AddReimbursementCommand = commonsZ.infer<typeof AddReimbursementCommandSchema>;
export type UpdateReimbursementCommand = commonsZ.infer<typeof UpdateReimbursementCommandSchema>;
export type DeleteReimbursementCommand = commonsZ.infer<typeof DeleteReimbursementCommandSchema>;
export type ConfirmExpensesCompleteCommand = commonsZ.infer<typeof ConfirmExpensesCompleteCommandSchema>;
export type ReopenExpensesCommand = commonsZ.infer<typeof ReopenExpensesCommandSchema>;
export type AddItineraryItemCommand = commonsZ.infer<typeof AddItineraryItemCommandSchema>;
export type UpdateItineraryItemCommand = commonsZ.infer<typeof UpdateItineraryItemCommandSchema>;
export type DeleteItineraryItemCommand = commonsZ.infer<typeof DeleteItineraryItemCommandSchema>;
export type UpdateParticipationCommand = commonsZ.infer<typeof UpdateParticipationCommandSchema>;
export type AddMomentCommand = commonsZ.infer<typeof AddMomentCommandSchema>;
export type ImportedItineraryItem = commonsZ.infer<typeof ImportedItineraryItemSchema>;
export type PlanImportSourceKind = commonsZ.infer<typeof PlanImportSourceKindSchema>;
export type PlanImportPreviewItem = commonsZ.infer<typeof PlanImportPreviewItemSchema>;
export type PlanImportPreview = commonsZ.infer<typeof PlanImportPreviewSchema>;
export type CreateCommonsRequest = commonsZ.infer<typeof CreateCommonsRequestSchema>;
export type CommonsInvitation = commonsZ.infer<typeof CommonsInvitationSchema>;
export type CreateCommonsResult = commonsZ.infer<typeof CreateCommonsResultSchema>;
export type CreateCommonsDraftRequest = commonsZ.infer<typeof CreateCommonsDraftRequestSchema>;
export type CreateCommonsDraftResult = commonsZ.infer<typeof CreateCommonsDraftResultSchema>;
export type SetupTravelerInput = commonsZ.infer<typeof SetupTravelerInputSchema>;
export type SaveSetupTravelersRequest = commonsZ.infer<typeof SaveSetupTravelersRequestSchema>;
export type SetupTraveler = commonsZ.infer<typeof SetupTravelerSchema>;
export type CommonsSetup = commonsZ.infer<typeof CommonsSetupSchema>;
export type CommonsPersonInvitation = commonsZ.infer<typeof CommonsPersonInvitationSchema>;
export type CommonsPerson = commonsZ.infer<typeof CommonsPersonSchema>;
export type CommonsPeople = commonsZ.infer<typeof CommonsPeopleSchema>;
export type TravelerProfile = commonsZ.infer<typeof TravelerProfileSchema>;
export type UpdateTravelerProfileRequest = commonsZ.infer<typeof UpdateTravelerProfileRequestSchema>;
export type AddCommonsPersonRequest = commonsZ.infer<typeof AddCommonsPersonRequestSchema>;
export type UpdateCommonsPersonRoleRequest = commonsZ.infer<typeof UpdateCommonsPersonRoleRequestSchema>;
export type UpdateCommonsInvitationRequest = commonsZ.infer<typeof UpdateCommonsInvitationRequestSchema>;
export type InvitationLink = commonsZ.infer<typeof InvitationLinkSchema>;
export type InvitationDeliveryAction = commonsZ.infer<typeof InvitationDeliveryActionSchema>;
export type CommitSetupImportRequest = commonsZ.infer<typeof CommitSetupImportRequestSchema>;
export type InvitationDelivery = commonsZ.infer<typeof InvitationDeliverySchema>;
export type SendSetupInvitationsResult = commonsZ.infer<typeof SendSetupInvitationsResultSchema>;
export type InvitationPreview = commonsZ.infer<typeof InvitationPreviewSchema>;

export const UpdateMoneySettingsCommandSchema = commonsZ.object({
  commandId: commonsZ.string().uuid(),
  currency: commonsZ.string().regex(/^[A-Z]{3}$/),
  expectedCurrency: commonsZ.string().regex(/^[A-Z]{3}$/),
  balancesDisabled: commonsZ.boolean(),
  expectedBalancesDisabled: commonsZ.boolean(),
}).strict();
