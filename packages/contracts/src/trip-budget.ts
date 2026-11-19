import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "./currencies";

const rawNumber = z.string().max(64);
/** A planning worksheet, including unfinished entries. Never an expense or balance. */
export const TripBudgetInputsSchema = z.object({
  currency: z.string().refine(value => SUPPORTED_CURRENCIES.some(currency => currency.code === value), "Choose a supported currency."),
  travelers: rawNumber, nights: rawNumber,
  lodgingBasis: z.enum(["property", "room"]), lodgingPerNight: rawNumber, rooms: rawNumber,
  mealsPerPersonPerDay: rawNumber, mealDays: rawNumber, mealDaysFollowNights: z.boolean(),
  transportTotal: rawNumber, activitiesTotal: rawNumber, travelPerPerson: rawNumber, bufferPercent: rawNumber,
  optional: z.array(z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), label: z.string().max(500), perPerson: rawNumber, participants: rawNumber }).strict()).max(8)
    .refine(rows => new Set(rows.map(row => row.id)).size === rows.length, "Each extra needs its own identifier."),
}).strict();
export type TripBudgetInputs = z.infer<typeof TripBudgetInputsSchema>;
export const SaveTripBudgetSchema = z.object({ expectedVersion: z.number().int().min(0), inputs: TripBudgetInputsSchema }).strict();
export const TripBudgetViewSchema = z.object({ inputs: TripBudgetInputsSchema.nullable(), version: z.number().int().min(0), updatedAt: z.string().nullable(), canEdit: z.boolean() }).strict();
export type TripBudgetView = z.infer<typeof TripBudgetViewSchema>;
