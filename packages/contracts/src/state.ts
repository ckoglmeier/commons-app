import { z as stateZ } from "zod";
import { ProposalSchema } from "./proposal";
import { FlightConnectionSchema } from "./travel";

export const ConversationMessageSchema = stateZ.object({
  id: stateZ.string().min(1),
  actorId: stateZ.string().min(1),
  actorName: stateZ.string().min(1),
  actorType: stateZ.enum(["human", "commons"]),
  body: stateZ.string().min(1),
  occurredAt: stateZ.string().datetime(),
  source: stateZ.enum(["channel", "web"]),
  attachments: stateZ.array(stateZ.object({
    kind: stateZ.literal("photo"),
    assetUrl: stateZ.string().min(1),
    altText: stateZ.string().min(1),
    caption: stateZ.string().min(1).optional(),
  })).optional(),
});

export const MealReservationSchema = stateZ.object({ number: stateZ.string().trim().max(120), note: stateZ.string().trim().max(1000) });
export type MealReservation = stateZ.infer<typeof MealReservationSchema>;

export const MealTypeSchema = stateZ.enum(["restaurant", "home"]);
export type MealType = stateZ.infer<typeof MealTypeSchema>;

/** A map position someone saved for a place. Exact means the place itself;
 * approximate means an area, such as a rental whose address is withheld.
 * The source says where the position came from; a person saved it either way. */
export const PlacePinSchema = stateZ.object({
  latitude: stateZ.number().min(-90).max(90),
  longitude: stateZ.number().min(-180).max(180),
  precision: stateZ.enum(["exact", "approximate"]),
  source: stateZ.enum(["map_link", "page", "placed"]),
}).strict();
export type PlacePin = stateZ.infer<typeof PlacePinSchema>;

export const ItineraryItemSchema = stateZ.object({
  id: stateZ.string().min(1),
  arrangerPersonId: stateZ.string().min(1).optional(),
  arrangerName: stateZ.string().min(1).optional(),
  arrangerActive: stateZ.boolean().optional(),
  proposalId: stateZ.string().min(1).optional(),
  title: stateZ.string().min(1),
  mealType: MealTypeSchema.nullable().optional(),
  mealReservation: MealReservationSchema.optional(),
  startsAt: stateZ.string().datetime().nullable(),
  scheduledDate: stateZ.string().date().nullable().optional(),
  endsAt: stateZ.string().datetime().optional(),
  durationMinutes: stateZ.number().positive().nullable().optional(),
  location: stateZ.string().min(1).optional(),
  pin: PlacePinSchema.optional(),
  participantScope: stateZ.enum(["everyone", "subgroup", "optional"]),
  participantIds: stateZ.array(stateZ.string().min(1)).optional(),
  respondedParticipantIds: stateZ.array(stateZ.string().min(1)).optional(),
  status: stateZ.enum(["idea", "planned", "confirmed", "cancelled"]),
  expectedCostCurrency: stateZ.string().regex(/^[A-Z]{3}$/).optional(),
  expectedCostCents: stateZ.number().int().positive().optional(),
  expectedCostBasis: stateZ.enum(["total", "per_person"]).optional(),
  expectedParticipantIds: stateZ.array(stateZ.string().min(1)).optional(),
  note: stateZ.string().min(1).optional(),
  sourceUrl: stateZ.string().url().refine(
    (value) => value.startsWith("https://") || value.startsWith("http://"),
    "Source links must use http or https.",
  ).optional(),
  provenanceLabel: stateZ.string().min(1),
  /** Row version token (last saved time) for reviewed field-level updates. */
  version: stateZ.string().datetime().optional(),
});

export const AuditEventSchema = stateZ.object({
  id: stateZ.string().min(1),
  commandId: stateZ.string().min(1),
  actorId: stateZ.string().min(1),
  action: stateZ.string().min(1),
  targetId: stateZ.string().min(1),
  occurredAt: stateZ.string().datetime(),
  summary: stateZ.string().min(1),
});

export const ExpenseShareSchema = stateZ.object({
  personId: stateZ.string().min(1),
  amountCents: stateZ.number().int().nonnegative(),
});

export const ExpenseSchema = stateZ.object({
  id: stateZ.string().min(1),
  title: stateZ.string().min(1),
  amountCents: stateZ.number().int().positive(),
  currency: stateZ.string().length(3),
  paidByPersonId: stateZ.string().min(1),
  paidByName: stateZ.string().min(1),
  occurredOn: stateZ.string().date(),
  category: stateZ.string().min(1),
  status: stateZ.enum(["draft", "confirmed", "disputed"]),
  splitMethod: stateZ.enum(["equal", "exact", "shares", "percentage"]),
  balanceMode: stateZ.enum(["allocated", "tracking_only", "budget_only"]).optional(),
  receiptStatus: stateZ.enum(["not_attached", "attached", "not_expected"]),
  itineraryItemId: stateZ.string().min(1).optional(),
  stayId: stateZ.string().min(1).optional(),
  travelPlanId: stateZ.string().min(1).optional(),
  confirmationCode: stateZ.string().min(1).optional(),
  receiptFileName: stateZ.string().min(1).optional(),
  receiptUrl: stateZ.string().min(1).optional(),
  sourceLabel: stateZ.string().min(1),
  note: stateZ.string().min(1).optional(),
  shares: stateZ.array(ExpenseShareSchema).min(1),
});

export const ReimbursementSchema = stateZ.object({
  id: stateZ.string().min(1),
  fromPersonId: stateZ.string().min(1),
  fromPersonName: stateZ.string().min(1),
  toPersonId: stateZ.string().min(1),
  toPersonName: stateZ.string().min(1),
  amountCents: stateZ.number().int().positive(),
  currency: stateZ.string().length(3),
  occurredOn: stateZ.string().date(),
  sourceLabel: stateZ.string().min(1),
});

export const TravelPlanSchema = stateZ.object({
  id: stateZ.string().min(1),
  version: stateZ.string().optional(),
  connections: stateZ.array(FlightConnectionSchema).max(8).optional(),
  personId: stateZ.string().min(1),
  personIds: stateZ.array(stateZ.string().min(1)).min(1).optional(),
  personName: stateZ.string().min(1),
  kind: stateZ.enum(["arrival", "departure", "car_rental", "transport"]),
  date: stateZ.string().date(),
  route: stateZ.string().min(1),
  time: stateZ.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  driverPersonId: stateZ.string().min(1).optional(),
  driverName: stateZ.string().min(1).optional(),
  provider: stateZ.string().min(1).optional(),
  vehicle: stateZ.string().min(1).optional(),
  returnDate: stateZ.string().date().optional(),
  returnTime: stateZ.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  status: stateZ.enum(["considering", "booked", "confirmed"]).optional(),
  note: stateZ.string(),
  visibility: stateZ.enum(["private", "basic", "all"]).optional(),
  confirmationCode: stateZ.string().min(1).optional(),
  totalCents: stateZ.number().int().positive().optional(),
  currency: stateZ.string().length(3).optional(),
  sourceLabel: stateZ.string().min(1),
  confirmationDocumentFileName: stateZ.string().min(1).optional(),
  confirmationDocumentUrl: stateZ.string().min(1).optional(),
});

export const StaySchema = stateZ.object({
  id: stateZ.string().min(1),
  name: stateZ.string().min(1),
  // An option being considered may be only a name and a link.
  address: stateZ.string(),
  pin: PlacePinSchema.optional(),
  startsOn: stateZ.string().date(),
  endsOn: stateZ.string().date(),
  timezone: stateZ.string().max(64).optional(),
  checkInTime: stateZ.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  checkOutTime: stateZ.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  status: stateZ.enum(["considering", "planned", "confirmed"]),
  includedPersonIds: stateZ.array(stateZ.string().min(1)).min(1),
  bookingUrl: stateZ.string().url().optional(),
  pollId: stateZ.string().min(1).optional(),
  confirmationCode: stateZ.string().min(1).optional(),
  totalCents: stateZ.number().int().positive().optional(),
  /** A per-room price for the whole stay, as hotels quote it. */
  roomPriceCents: stateZ.number().int().positive().optional(),
  roomCount: stateZ.number().int().min(1).max(50).optional(),
  currency: stateZ.string().length(3).optional(),
  costSource: stateZ.enum(["estimate", "confirmation", "expense"]).optional(),
  includesTaxesAndFees: stateZ.boolean().optional(),
  details: stateZ.string().min(1).optional(),
  sourceLabel: stateZ.string().min(1),
  confirmationDocumentFileName: stateZ.string().min(1).optional(),
  confirmationDocumentUrl: stateZ.string().min(1).optional(),
});

export const MomentSchema = stateZ.object({
  id: stateZ.string().min(1),
  kind: stateZ.literal("photo"),
  assetUrl: stateZ.string().min(1),
  caption: stateZ.string().min(1),
  altText: stateZ.string().min(1),
  occurredAt: stateZ.string().datetime(),
  addedByPersonId: stateZ.string().min(1).optional(),
  addedByName: stateZ.string().min(1).optional(),
  sourceLabel: stateZ.string().min(1),
  dateStatus: stateZ.enum(["confirmed", "unconfirmed"]).optional(),
  itineraryItemId: stateZ.string().min(1).optional(),
  itineraryItemTitle: stateZ.string().min(1).optional(),
  eventMatch: stateZ.object({
    source: stateZ.enum(["automatic", "manual"]),
    confidence: stateZ.number().int().min(0).max(100),
    reason: stateZ.string().min(1),
  }).optional(),
});

export const CommonsStateSchema = stateZ.object({
  commonsId: stateZ.string().min(1),
  targetBudgetCurrency: stateZ.string().regex(/^[A-Z]{3}$/).optional(),
  targetBudgetCents: stateZ.number().int().positive().optional(),
  messages: stateZ.array(ConversationMessageSchema),
  pollRequests: stateZ.array(stateZ.object({
    id: stateZ.string().uuid(), publicId: stateZ.string().regex(/^[0-9a-f]{12}$/),
    title: stateZ.string(), status: stateZ.enum(["open", "closed"]),
    responded: stateZ.boolean(), canManage: stateZ.boolean(),
    itinerary: stateZ.boolean().optional(), superseded: stateZ.boolean().optional(),
  })).optional(),
  proposals: stateZ.array(ProposalSchema),
  itinerary: stateZ.array(ItineraryItemSchema),
  auditEvents: stateZ.array(AuditEventSchema),
  processedCommandIds: stateZ.array(stateZ.string()),
  participation: stateZ.record(stateZ.string(), stateZ.enum(["in", "maybe", "skip"])),
  expenses: stateZ.array(ExpenseSchema).default([]),
  reimbursements: stateZ.array(ReimbursementSchema).default([]),
  travelPlans: stateZ.array(TravelPlanSchema).optional(),
  stays: stateZ.array(StaySchema).optional(),
  moments: stateZ.array(MomentSchema).default([]),
});

export type ConversationMessage = stateZ.infer<typeof ConversationMessageSchema>;
export type ItineraryItem = stateZ.infer<typeof ItineraryItemSchema>;
export type AuditEvent = stateZ.infer<typeof AuditEventSchema>;
export type ExpenseShare = stateZ.infer<typeof ExpenseShareSchema>;
export type Expense = stateZ.infer<typeof ExpenseSchema>;
export type Reimbursement = stateZ.infer<typeof ReimbursementSchema>;
export type TravelPlan = stateZ.infer<typeof TravelPlanSchema>;
export type Stay = stateZ.infer<typeof StaySchema>;
export type Moment = stateZ.infer<typeof MomentSchema>;
export type CommonsState = stateZ.infer<typeof CommonsStateSchema>;
