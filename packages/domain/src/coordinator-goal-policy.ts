import { GoalEnvelopeSchema, type GoalEnvelope, type GoalOperationRequest, type PollCompletionRule } from "@commons/contracts";

/** Code owns capability, scope and finite budgets. No model/client authority fields. */
export function goalEnvelope(input: Extract<GoalOperationRequest, { op: "start" }>): GoalEnvelope {
  const steps: GoalEnvelope["steps"] = [];
  if (input.kind === "research") steps.push({ kind: "research", query: input.query || input.goal.slice(0, 500) });
  if (input.kind === "poll") steps.push({ kind: "poll", pollId: null, rule: input.pollRule ?? { mode: "manual" } });
  if (input.kind === "planning") {
    if (!input.workflowRunId) throw new Error("A planning goal needs a saved workflow.");
    steps.push({ kind: "planning", runId: input.workflowRunId });
  } else if (input.workflowRunId) throw new Error("Only planning goals can own a planning workflow.");
  if (input.kind === "plan_action") steps.push({ kind: "plan_action", turnId: null });
  if (input.kind === "participant") {
    if (!input.recipientPersonId || !input.question) throw new Error("A participant task needs one recipient and a bounded question.");
    steps.push({ kind: "outreach", recipientPersonId: input.recipientPersonId, question: input.question, maxFollowUps: 0 });
  }
  if (input.then.length && input.kind !== "research") throw new Error("Only research may precede a poll or reviewed proposal.");
  if (new Set(input.then).size !== input.then.length || input.then.join(",") === "plan_action,poll") throw new Error("Steps must follow research, poll, then proposal order.");
  for (const kind of input.then) steps.push(kind === "poll" ? { kind, pollId: null, rule: input.pollRule ?? { mode: "manual" } } : { kind, turnId: null });
  const kinds = steps.map(step => step.kind);
  return GoalEnvelopeSchema.parse({ version: 1, capability: input.kind, audience: "organizers", steps,
    contextRefs: input.ideaIds.map(id => ({ type: "idea", id })),
    permitted: [...(kinds.includes("research") ? ["research.public_sources"] : []), ...(kinds.includes("poll") ? ["poll.read_responses"] : []), ...(kinds.includes("plan_action") ? ["plan.apply_reviewed_proposal"] : []), ...(kinds.includes("outreach") ? ["participant.sms.ask"] : [])],
    wake: ["answer", ...(kinds.includes("plan_action") ? ["approval"] : []), ...(kinds.includes("poll") ? ["poll_response", "poll_closed", "deadline"] : []), ...(kinds.includes("outreach") ? ["outreach_reply"] : [])],
    report: ["completed", "needs_input", "needs_approval", "failed", "milestone"],
    budget: { maxSteps: steps.length, maxAttemptsPerStep: 3, maxDurationHours: 24 * 7, maxToolCalls: kinds.includes("research") ? 12 : 0, spendCents: 0 }, modelPolicyVersion: "existing-research-v1" });
}

export function pollStepComplete(rule: PollCompletionRule, input: { closed: boolean; responseCount: number; invitedIds: string[] | null; respondedIds: string[]; now: number; manual: boolean }) {
  if (input.closed || input.manual) return true;
  if (rule.mode === "manual") return false;
  if (rule.mode === "deadline") return input.now >= Date.parse(rule.at);
  if (rule.mode === "count") return input.responseCount >= rule.count;
  // A link poll, guest emails and a secret ballot cannot prove named-person coverage.
  return input.invitedIds !== null && input.invitedIds.length > 0 && input.invitedIds.every(id => input.respondedIds.includes(id));
}

export const goalFinishLine = { planning: "An organizer reviews the evidence and approves a current outcome. Responses alone do not finish the goal.", research: "Return source links, coverage and explicit unknowns.", poll: "Summarize the saved responses when the collection rule is met.", plan_action: "Return the receipt after the exact reviewed change is approved.", participant: "Record the participant’s answer or a truthful timeout.", book: "Booking is unavailable." } as const;
