import { z } from "zod";
import { SaveTripTaskSchema } from "./trip-tasks";

export const CoordinatorTripTaskProposalSchema = z.object({
  version: z.number().int().positive(), state: z.enum(["pending", "applied", "dismissed"]),
  quickAdd: z.boolean().optional(), requestedBy: z.string().uuid(), task: SaveTripTaskSchema,
  receipt: z.object({ id: z.string().uuid(), version: z.number().int().positive(), at: z.string().datetime(), appliedBy: z.string().uuid() }).nullable(),
});
export type CoordinatorTripTaskProposal = z.infer<typeof CoordinatorTripTaskProposalSchema>;
export const CoordinatorTripTaskActionSchema = z.object({
  action: z.literal("trip_task"), operation: z.enum(["apply", "dismiss", "undo"]),
  turnId: z.string().uuid(), threadId: z.string().uuid(), commandId: z.string().uuid(), expectedVersion: z.number().int().positive(),
}).strict();
