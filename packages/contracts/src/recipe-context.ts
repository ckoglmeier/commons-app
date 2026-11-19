import { z } from "zod";

/** Private, minimized handoff on the existing poll draft. Context grants no authority. */
export const RecipeContextSchema = z.object({
  version: z.literal(1),
  fingerprint: z.string().length(64),
  trip: z.object({ startsOn: z.string().nullable(), endsOn: z.string().nullable(), locationNames: z.array(z.string()) }).strict(),
  sources: z.array(z.object({
    runId: z.string().uuid(), outcomeId: z.string().uuid(), decisionId: z.string().uuid(), pollId: z.string().uuid(),
    kind: z.enum(["dates_location", "attendance"]), status: z.enum(["approved", "applied"]),
    evidenceFingerprint: z.string().length(64), currentEvidenceFingerprint: z.string().length(64),
    approvedByName: z.string(), approvedAt: z.string(), stale: z.array(z.string()),
    /** The last approval remains in effect, but a newer round is asking again. */
    reconsidering: z.boolean().optional(),
    conditions: z.array(z.string()),
    needs: z.array(z.object({ name: z.string(), text: z.string(), resolution: z.string().nullable() }).strict()),
  }).strict()).max(2),
  attendance: z.object({ outcomeId: z.string().uuid(), in: z.number().int().nonnegative(), maybe: z.number().int().nonnegative(),
    people: z.array(z.object({ name: z.string(), state: z.enum(["in", "maybe", "out", "unanswered"]), partySize: z.number().nullable() }).strict()),
  }).strict().nullable(),
}).strict();
export type RecipeContext = z.infer<typeof RecipeContextSchema>;
