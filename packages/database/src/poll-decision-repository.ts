import { ApprovePollDecisionSchema, type ApprovePollDecision } from "@commons/contracts";
import { and, eq } from "drizzle-orm";
import { createDatabase } from "./client";
import { runEventCommand, type CommandTransaction } from "./event-command";
import { readPollEvidence } from "./poll-evidence";
import { PollRepositoryError, getCommonsPollDetail, type PollRepositoryOptions } from "./poll-repository";
import { commons, itineraryItems, pollDecisions, polls } from "./schema";
import { publishedPollReplacement } from "./poll-delivery-repository";

/** The decision rules for the poll workspace. Runs inside the caller's event command. */
export async function recordPollDecisionInTransaction(tx: CommandTransaction, context: { id: string; displayName: string }, actorPersonId: string, pollId: string, input: ApprovePollDecision, options: { allowNoSelection?: boolean } = {}) {
        const [poll] = await tx.select().from(polls).where(eq(polls.id, pollId)).for("update").limit(1);
        if (poll.status !== "closed") throw new PollRepositoryError("invalid_response", "Close voting before reviewing a decision.");
        if (await publishedPollReplacement(tx, pollId)) throw new PollRepositoryError("invalid_response", "This version was superseded. Review the replacement poll instead of approving historical responses.");
        const [existing] = await tx.select({ id: pollDecisions.id }).from(pollDecisions).where(eq(pollDecisions.pollId, pollId));
        if (existing) throw new PollRepositoryError("invalid_response", "This round already has an approved decision. Start a follow-up round to reconsider it.");
        const { evidence, fingerprint } = await readPollEvidence(tx, poll);
        if (fingerprint !== input.evidenceFingerprint) throw new PollRepositoryError("invalid_response", "Responses, audience, or trip details changed. Reload and review the evidence again.");
        if (!options.allowNoSelection && poll.questions.some(question => question.kind !== "choice" && question.kind !== "text")) throw new PollRepositoryError("invalid_response", "This decision form does not support grouped responses, rankings or points.");
        if (!input.selected.length && !options.allowNoSelection && poll.questions.some(question => question.kind === "choice")) throw new PollRepositoryError("invalid_response", "Choose an option before approving a decision for this poll.");
        if (new Set(input.selected.map(item => item.questionId)).size !== input.selected.length) throw new PollRepositoryError("invalid_response", "Choose at most one option for each decision.");
        for (const selection of input.selected) {
          const question = poll.questions.find(item => item.id === selection.questionId);
          if (question?.kind !== "choice" || !question.options.some(option => option.id === selection.optionId)) throw new PollRepositoryError("invalid_response", "Review the selected options again.");
        }
        for (const response of evidence.responses) for (const answer of response.answers) {
          if (answer.context?.kind === "need" && !input.needResolutions.some(item => item.responseId === response.id && item.questionId === answer.questionId)) throw new PollRepositoryError("invalid_response", "Explain how each stated need is handled before approving. A vote alone does not resolve it.");
        }
        if (input.target === "plan_idea" && !input.audienceExpansionApproved) throw new PollRepositoryError("invalid_response", "Explicitly approve sharing the decision summary with the whole trip before adding it to Plan.");
        let planId: string | null = null;
        if (input.target === "plan_idea") {
          const [event] = await tx.select({ timezone: commons.timezone }).from(commons).where(eq(commons.id, context.id));
          const [plan] = await tx.insert(itineraryItems).values({ commonsId: context.id, title: input.summary.slice(0, 120),
            timezone: event.timezone, audience: "everyone", status: "idea", note: input.summary,
            provenanceLabel: `${context.displayName} approved a poll decision · ${poll.id}` }).returning({ id: itineraryItems.id });
          planId = plan.id;
        }
        const [decision] = await tx.insert(pollDecisions).values({ pollId, approvedByPersonId: actorPersonId, approvedByName: context.displayName,
          evidenceFingerprint: fingerprint, evidence, approval: input, summary: input.summary, target: input.target, planId }).returning({ id: pollDecisions.id });
        return decision.id;
}

export async function approvePollDecision(identifier: string, pollId: string, rawInput: unknown, options: PollRepositoryOptions) {
  const input = ApprovePollDecisionSchema.parse(rawInput);
  const database = createDatabase(options.databaseUrl);
  try {
    await database.db.transaction(tx => runEventCommand(tx, { identifier, actorPersonId: options.actorPersonId, commandId: input.commandId, action: "poll.decision_approved", input: { pollId, ...input } },
      async context => {
        const [poll] = await tx.select().from(polls).where(and(eq(polls.commonsId, context.id), eq(polls.id, pollId))).limit(1);
        if (!poll || (context.role !== "organizer" && poll.createdByPersonId !== options.actorPersonId)) throw new PollRepositoryError("actor_not_authorized", "Only an organizer or the poll creator can approve a decision.");
        if (input.target === "plan_idea" && context.role !== "organizer") throw new PollRepositoryError("actor_not_authorized", "An organizer must approve a decision shared into Plan.");
      }, async context => {
        const decisionId = await recordPollDecisionInTransaction(tx, context, options.actorPersonId, pollId, input);
        return { result: { decisionId }, resourceType: "poll_decision", resourceId: decisionId,
          summary: input.target === "plan_idea" ? "Approved a poll decision and added its reviewed summary as a Plan idea." : "Approved a decision for the poll audience. No trip plans changed." };
      }));
    return getCommonsPollDetail(identifier, pollId, options);
  } finally { await database.close(); }
}
