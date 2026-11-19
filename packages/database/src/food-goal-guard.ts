import { and, eq } from "drizzle-orm";
import type { PollQuestion } from "@commons/contracts";
import { CommandAccessError, CommandConflictError, type CommandTransaction } from "./event-command";
import { recipeRuns } from "./schema";

/** Both generic draft edits and canonical publication must enforce the food Goal's answer audience. */
export async function assertFoodGoalQuestions(tx: CommandTransaction, tripId: string, runId: string | null, questions: PollQuestion[], actorRole: string) {
  if (!runId) return;
  const [run] = await tx.select({ recipe: recipeRuns.recipe }).from(recipeRuns).where(and(eq(recipeRuns.id, runId), eq(recipeRuns.commonsId, tripId)));
  if (run?.recipe !== "food_preferences") return;
  if (actorRole !== "organizer") throw new CommandAccessError();
  if (questions.some(q => q.kind !== "text" || q.organizerOnly !== true || !q.foodField)) throw new CommandConflictError();
}
