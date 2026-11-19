import { z } from "zod";

// The server supplies identity, role and trip context; callers cannot choose a recipient or organizer thread.
export const PersonalCoordinatorCommandSchema = z.object({commandId:z.string().uuid(),text:z.string().min(1).max(1800).refine(value=>Boolean(value.trim()))}).strict();
export const PersonalCoordinatorTurnSchema = z.object({id:z.string().uuid(),commandId:z.string().uuid(),userText:z.string(),reply:z.string().nullable(),status:z.enum(["pending","completed","failed"]),createdAt:z.string().datetime()});
export const PersonalCoordinatorHistorySchema = z.array(PersonalCoordinatorTurnSchema).max(40);
export type PersonalCoordinatorTurn = z.infer<typeof PersonalCoordinatorTurnSchema>;
