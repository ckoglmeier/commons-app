import { z } from "zod";
export const TripTaskSchema = z.object({
    id: z.string().uuid(), title: z.string().min(1).max(160), ownerPersonId: z.string().uuid(),
    dueOn: z.string().date().nullable(), completed: z.boolean(), version: z.number().int().positive(),
    itemKind: z.enum(["plan", "travel", "stay"]).nullable(), itemId: z.string().uuid().nullable(), itemTitle: z.string().nullable(), suggestedByCommons: z.boolean().default(false), suggestionKey: z.string().nullable().default(null),
});
export type TripTask = z.infer<typeof TripTaskSchema>;
export const SaveTripTaskSchema = z.object({
    commandId: z.string().uuid(), id: z.string().uuid(), expectedVersion: z.number().int().nonnegative(),
    title: z.string().trim().min(1).max(160), ownerPersonId: z.string().uuid(), dueOn: z.string().date().nullable(),
    completed: z.boolean().default(false), itemKind: z.enum(["plan", "travel", "stay"]).nullable().default(null), itemId: z.string().uuid().nullable().default(null),
}).strict().refine(value => (value.itemKind === null) === (value.itemId === null), { message: "Choose both the trip item kind and item, or leave both empty.", path: ["itemId"] });
