import type { CoordinatorRecommendation, PollDetail } from "@commons/contracts";

/** Deliberately omit credentials, email audience and unused response identities. */
export function coordinatorPollContext(poll: PollDetail, participantArtifact = false) {
  const privateIds = new Set(poll.questions.filter(q => q.organizerOnly || q.kind === "text" && q.foodField).map(q => q.id));
  return { title: poll.title, status: poll.status, createdAt: poll.createdAt, responseCount: poll.responseCount,
    questions: poll.questions, aggregates: participantArtifact ? poll.aggregates.filter(a => !privateIds.has(a.questionId)) : poll.aggregates, decision: participantArtifact && privateIds.size ? null : poll.decision ?? null,
    // Keep each ballot together: separate option majorities are not a joint agreement.
    // Enforce secret-ballot suppression here as well as at the repository boundary.
    responses: poll.ballotMode === "secret" ? [] : poll.responses.slice(0, 40).map(response => ({ answers: participantArtifact ? response.answers?.filter(a => !privateIds.has(a.questionId)) : response.answers, updatedAt: response.updatedAt })),
    ballotMode: poll.ballotMode, resultsVisible: poll.resultsVisible,
    responsesTruncated: poll.responses.length > 40 };
}

/** Prepared advice is private context, bounded and descriptive only. It carries no operator identity or authority. */
export function coordinatorRecommendationContext(recommendation: CoordinatorRecommendation, sourcePollTitle?: string) {
  return {
    sourcePoll: sourcePollTitle ?? "Source poll", recommendation: recommendation.recommendation, freshness: recommendation.freshness,
    uncertainties: recommendation.uncertainties, openQuestions: recommendation.openQuestions, nextAction: recommendation.nextAction,
    evidenceCurrent: recommendation.evidenceCurrent !== false,
  };
}
