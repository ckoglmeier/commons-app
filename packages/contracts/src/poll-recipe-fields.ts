import { z } from "zod";

/**
 * Typed markers a guided recipe puts on poll options. The label stays the human text; the marker is what summaries and approved
 * outcomes read, so nothing is recovered by parsing wording. Validation keeps the two in step.
 */
export const attendanceStates = ["in", "maybe", "out"] as const;
export const AttendanceStateSchema = z.enum(attendanceStates);
export type AttendanceState = z.infer<typeof AttendanceStateSchema>;
export const attendanceLabels: Record<AttendanceState, string> = { in: "I’ll be there", maybe: "Maybe", out: "I can’t make it" };

export const PartySizeSchema = z.number().int().min(1).max(12);
export function partySizeLabel(size: number) { return size === 1 ? "Just me" : `${size} people`; }

export const sleepingNeeds = ["own_bed", "share_bed", "separate_beds", "no_preference"] as const;
export const SleepingNeedSchema = z.enum(sleepingNeeds);
export type SleepingNeed = z.infer<typeof SleepingNeedSchema>;
export const sleepingLabels: Record<SleepingNeed, string> = {
  own_bed: "My own bed", share_bed: "I’m happy to share a bed", separate_beds: "I’d share a room with separate beds", no_preference: "No preference",
};

/** A supplied lodging option. Prices here are the organizer's estimate, never a supplier quote or availability. */
export const PollPropertySchema = z.object({
  rooms: z.string().trim().min(1, "Describe the rooms.").max(180),
  beds: z.enum(["separate_beds_available", "king_only", "unknown"]),
  pricing: z.object({
    basis: z.enum(["per_person", "per_room", "total"]),
    period: z.enum(["nightly", "stay"]),
    currency: z.string().regex(/^[A-Z]{3}$/),
    minCents: z.number().int().min(0).max(100_000_000).nullable(),
    maxCents: z.number().int().min(0).max(100_000_000).nullable(),
    fees: z.enum(["included", "excluded", "unknown"]),
  }).strict().superRefine((value, ctx) => {
    if ((value.minCents === null) !== (value.maxCents === null)) ctx.addIssue({ code: "custom", message: "Give both ends of the estimate, or leave the price unknown.", path: ["maxCents"] });
    else if (value.minCents !== null && value.maxCents !== null && value.minCents > value.maxCents) ctx.addIssue({ code: "custom", message: "The low end of the estimate is above the high end.", path: ["minCents"] });
  }),
}).strict();
export type PollProperty = z.infer<typeof PollPropertySchema>;

export function formatEstimate(pricing: PollProperty["pricing"]) {
  if (pricing.minCents === null || pricing.maxCents === null) return "Price unknown";
  const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: pricing.currency, maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
  const range = pricing.minCents === pricing.maxCents ? money(pricing.minCents) : `${money(pricing.minCents)}–${money(pricing.maxCents)}`;
  const basis = { per_person: "per person", per_room: "per room", total: "for the whole group" }[pricing.basis];
  return `Organizer’s estimate: ${range} ${basis}, ${pricing.period === "nightly" ? "per night" : "for the stay"}; fees ${pricing.fees === "unknown" ? "unknown" : pricing.fees}. Not a quote.`;
}
