import { z } from "zod";
import { CoordinatorResearchSchema } from "./coordinator";

/** Validated data, not authorization. Servers resolve identities and grants. */
export const DelegationPrincipalSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("human"), personId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal("agent"), agentId: z.string().uuid(), grantId: z.string().uuid() }).strict(),
]);

/** The first capability is read-only research; no generic tool/action payload. */
export const ResearchDelegationRequestSchema = z.object({
  protocolVersion: z.literal(1),
  commandId: z.string().uuid(),
  commonsId: z.string().uuid(),
  threadId: z.string().uuid(),
  parentTaskId: z.string().uuid().nullable(),
  caller: DelegationPrincipalSchema,
  capability: z.literal("research.public_sources"),
  input: z.object({ query: z.string().trim().min(1).max(500) }).strict(),
  routing: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("commons_specialist") }).strict(),
    z.object({ kind: z.literal("personal_agent"), personId: z.string().uuid(), agentId: z.string().uuid() }).strict(),
  ]),
  returnTo: z.object({ kind: z.literal("commons_thread"), threadId: z.string().uuid() }).strict(),
}).strict().refine(input => input.returnTo.threadId === input.threadId, {
  message: "Research returns to its originating thread.", path: ["returnTo", "threadId"],
});

/** Acceptance is separate from completion. Receipt IDs are allocated by Commons. */
export const DelegationReceiptSchema = z.object({
  protocolVersion: z.literal(1), taskId: z.string().uuid(), commandId: z.string().uuid(),
  acceptedAt: z.string().datetime(),
}).strict();

const resultIdentity = {
  taskId: z.string().uuid(), attemptId: z.string().uuid(), agentId: z.string().uuid(),
};

export const ResearchDelegationOutcomeSchema = z.discriminatedUnion("status", [
  z.object({ ...resultIdentity, status: z.literal("succeeded"), research: CoordinatorResearchSchema }).strict(),
  z.object({ ...resultIdentity, status: z.literal("needs_input"),
    reason: z.enum(["clarification_required", "authorization_required"]),
  }).strict(),
  z.object({ ...resultIdentity, status: z.literal("failed"),
    reason: z.enum(["provider_unavailable", "deadline_exceeded", "access_revoked", "attempts_exhausted"]),
  }).strict(),
]);

export type ResearchDelegationRequest = z.infer<typeof ResearchDelegationRequestSchema>;
export type DelegationReceipt = z.infer<typeof DelegationReceiptSchema>;
export type ResearchDelegationOutcome = z.infer<typeof ResearchDelegationOutcomeSchema>;

export const QueueWorkspaceResearchSchema = z.object({
  commandId: z.string().uuid(), threadId: z.string().uuid(), query: z.string().trim().min(1).max(500),
}).strict();
export const WorkspaceResearchTaskSchema = z.object({
  taskId: z.string().uuid(), query: z.string(),
  status: z.enum(["pending", "processing", "succeeded", "failed", "cancelled"]),
  errorCode: z.string().nullable(), acceptedAt: z.string().datetime(),
});
export const WorkspaceResearchTasksSchema = z.array(WorkspaceResearchTaskSchema);
export type WorkspaceResearchTask = z.infer<typeof WorkspaceResearchTaskSchema>;
