import { createFeedbackSubmission, feedbackActivity } from "@commons/database";
import { betaFeatureEnabled } from "@/lib/beta/flags";
import { feedbackDecision } from "@/lib/beta/feedback-guard";
import { createFeedbackRouteHandler, FeedbackLimitedError } from "@/lib/feedback-route";
import { commonsDatabaseUrl, readCommonsRuntimeEnvironment } from "@/lib/server/runtime-environment";
import { scheduleOperatorNotification } from "@/lib/server/operator-notifications";

export const maxDuration = 60;

export const POST = createFeedbackRouteHandler({
  save: async input => {
    const databaseUrl = commonsDatabaseUrl();
    if (!databaseUrl) throw new Error("Feedback storage unavailable.");
    // Beta rework: bound reports per trip context and overall, and fold an accidental double send into one report. Off by default.
    if (betaFeatureEnabled("feedback_guard", readCommonsRuntimeEnvironment())) {
      const message = input.questionVersion === 2 ? input.answers.message : Object.values(input.answers).join(" ");
      const activity = await feedbackActivity({ commonsSlug: input.commonsSlug, message }, { databaseUrl });
      const decision = feedbackDecision({ recentInContext: activity.inContext, recentGlobal: activity.global, duplicateRecent: Boolean(activity.duplicateId) });
      if (decision === "duplicate" && activity.duplicateId) return { id: activity.duplicateId };
      if (decision === "limited") throw new FeedbackLimitedError();
    }
    const submission = await createFeedbackSubmission(input, databaseUrl);
    scheduleOperatorNotification(`feedback:${submission.id}`);
    return submission;
  },
});
