import type { SubmitFeedbackRequest } from "@commons/contracts";
import { desc, eq } from "drizzle-orm";
import { createDatabase } from "./client";
import { feedbackSubmissions, operatorNotificationDeliveries } from "./schema";

type FeedbackSubmissionInput = SubmitFeedbackRequest;

export async function createFeedbackSubmission(
  input: FeedbackSubmissionInput,
  databaseUrl?: string,
) {
  const database = createDatabase(databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      const [created] = await tx
        .insert(feedbackSubmissions)
        .values({
          commonsSlug: input.commonsSlug,
          source: input.source,
          questionVersion: input.questionVersion,
          respondentName: input.respondentName || null,
          answers: input.answers,
          pagePath: input.pagePath,
          idempotencyKey: input.idempotencyKey,
        })
        .onConflictDoNothing({ target: feedbackSubmissions.idempotencyKey })
        .returning({ id: feedbackSubmissions.id });

      if (created) {
        await tx.insert(operatorNotificationDeliveries).values({ dedupeKey: `feedback:${created.id}`, payload: { kind: "feedback", feedbackId: created.id, submission: input } });
        return created;
      }

      const [existing] = await tx
        .select({ id: feedbackSubmissions.id })
        .from(feedbackSubmissions)
        .where(eq(feedbackSubmissions.idempotencyKey, input.idempotencyKey))
        .limit(1);

      if (!existing) throw new Error("Feedback was not saved.");
      return existing;
    });
  } finally {
    await database.close();
  }
}

export async function listFeedbackSubmissions(
  limit = 100,
  databaseUrl?: string,
) {
  const database = createDatabase(databaseUrl);
  try {
    return await database.db
      .select()
      .from(feedbackSubmissions)
      .orderBy(desc(feedbackSubmissions.createdAt))
      .limit(Math.max(1, Math.min(limit, 500)));
  } finally {
    await database.close();
  }
}
