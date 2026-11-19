import { z as proposalZ } from "zod";

export const ActorRoleSchema = proposalZ.enum(["organizer", "member"]);
export const IdentityStateSchema = proposalZ.enum([
  "observed",
  "channel_verified",
  "claimed",
]);

export const ActorSchema = proposalZ.object({
  id: proposalZ.string().min(1),
  displayName: proposalZ.string().min(1),
  role: ActorRoleSchema,
  identityState: IdentityStateSchema,
});

export const EvidenceReferenceSchema = proposalZ.object({
  messageId: proposalZ.string().min(1),
  excerpt: proposalZ.string().min(1),
  actorName: proposalZ.string().min(1),
  occurredAt: proposalZ.string().datetime(),
});

export const ProposalCorrectionSchema = proposalZ.object({
  actorName: proposalZ.string().min(1),
  note: proposalZ.string().min(1),
  occurredAt: proposalZ.string().datetime(),
});

export const GroupActivityPayloadSchema = proposalZ.object({
  kind: proposalZ.literal("group_activity"),
  title: proposalZ.string().min(1),
  startsAt: proposalZ.string().datetime(),
  endsAt: proposalZ.string().datetime().optional(),
  location: proposalZ.string().min(1).optional(),
  participantScope: proposalZ.enum(["everyone", "subgroup", "optional"]),
  correction: ProposalCorrectionSchema.optional(),
});

export const InformationalDetailPayloadSchema = proposalZ.object({
  kind: proposalZ.literal("informational_detail"),
  label: proposalZ.string().min(1),
  value: proposalZ.string().min(1),
});

export const ProposalPayloadSchema = proposalZ.discriminatedUnion("kind", [
  GroupActivityPayloadSchema,
  InformationalDetailPayloadSchema,
]);

export const ProposalStatusSchema = proposalZ.enum([
  "proposed",
  "approved",
  "rejected",
  "expired",
  "superseded",
]);

export const ProposalSchema = proposalZ.object({
  id: proposalZ.string().min(1),
  commonsId: proposalZ.string().min(1),
  version: proposalZ.number().int().positive(),
  status: ProposalStatusSchema,
  title: proposalZ.string().min(1),
  summary: proposalZ.string().min(1),
  affectedPersonIds: proposalZ.array(proposalZ.string().min(1)).min(1),
  createdAt: proposalZ.string().datetime(),
  expiresAt: proposalZ.string().datetime(),
  evidence: proposalZ.array(EvidenceReferenceSchema).min(1),
  payload: ProposalPayloadSchema,
  approvedBy: proposalZ.string().min(1).optional(),
  approvedAt: proposalZ.string().datetime().optional(),
});

export type Actor = proposalZ.infer<typeof ActorSchema>;
export type EvidenceReference = proposalZ.infer<typeof EvidenceReferenceSchema>;
export type Proposal = proposalZ.infer<typeof ProposalSchema>;
export type ProposalPayload = proposalZ.infer<typeof ProposalPayloadSchema>;
