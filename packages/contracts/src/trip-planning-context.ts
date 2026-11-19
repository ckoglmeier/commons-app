import { z } from "zod";

/** Organizer-authored guidance, separate from bookings, attendance and the Money target. */
export const TripPlanningContextSchema = z.object({
  summary: z.string().trim().max(500).nullable().default(null),
  pace: z.string().trim().max(160).nullable().default(null),
  goals: z.array(z.string().trim().min(1).max(180)).max(12).default([]),
  constraints: z.array(z.string().trim().min(1).max(180)).max(12).default([]),
  budgetMinimumCents: z.number().int().nonnegative().max(1_000_000_000).nullable().default(null),
  budgetMaximumCents: z.number().int().nonnegative().max(1_000_000_000).nullable().default(null),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable().default(null),
}).strict().superRefine((value, ctx) => {
  if (value.budgetMinimumCents !== null && value.budgetMaximumCents !== null && value.budgetMaximumCents < value.budgetMinimumCents)
    ctx.addIssue({ code: "custom", path: ["budgetMaximumCents"], message: "The upper budget must be at least the lower budget." });
  if ((value.budgetMinimumCents !== null || value.budgetMaximumCents !== null) && !value.currency)
    ctx.addIssue({ code: "custom", path: ["currency"], message: "Choose a currency for the planning budget." });
});
export type TripPlanningContext = z.infer<typeof TripPlanningContextSchema>;
export const TripPlanningContextStateSchema = z.object({
  defaultCurrency: z.string().regex(/^[A-Z]{3}$/).default("USD"),
  tripId: z.string().uuid(), name: z.string(), viewerId: z.string().uuid(),
  version: z.number().int().nonnegative(), updatedAt: z.string().datetime().nullable(), updatedByName: z.string().nullable(),
  brief: TripPlanningContextSchema,
});
export type TripPlanningContextState = z.infer<typeof TripPlanningContextStateSchema>;
export const SaveTripPlanningContextSchema = z.object({
  commandId: z.string().uuid(), expectedVersion: z.number().int().nonnegative(), brief: TripPlanningContextSchema,
}).strict();

/** Project only approved setup-brief fields. Never expose arbitrary JSON or the private setup transcript. */
export function readTripPlanningBrief(raw: unknown): TripPlanningContext {
  const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const fields = TripPlanningContextSchema.shape;
  const projected = Object.fromEntries(Object.entries(fields).map(([key, schema]) => {
    const parsed = schema.safeParse(source[key]);
    return [key, parsed.success ? parsed.data : key === "goals" || key === "constraints" ? [] : null];
  }));
  const result = TripPlanningContextSchema.safeParse(projected);
  if (result.success) return result.data;
  // Keep usable prose when an old brief has an incomplete/invalid budget.
  return TripPlanningContextSchema.parse({ ...projected, budgetMinimumCents: null, budgetMaximumCents: null });
}
