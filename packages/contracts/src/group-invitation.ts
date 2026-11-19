import { z } from "zod";

export const GroupInvitationTokenSchema = z.string().regex(/^g_[A-Za-z0-9_-]{32}$/);
const base = { commandId: z.string().uuid(), expectedVersion: z.number().int().nonnegative() };
export const ManageGroupInvitationSchema = z.discriminatedUnion("action", [
  z.object({ ...base, action: z.literal("create"), scopeAccepted: z.literal(true), expiresInDays: z.union([z.literal(7), z.literal(14), z.literal(30)]) }).strict(),
  z.object({ ...base, action: z.literal("replace"), scopeAccepted: z.literal(true), expiresInDays: z.union([z.literal(7), z.literal(14), z.literal(30)]) }).strict(),
  z.object({ ...base, action: z.literal("revoke") }).strict(),
]);
export const GroupInvitationSchema = z.object({
  id: z.string().uuid(), tripId: z.string().uuid(), version: z.number().int().positive(),
  state: z.enum(["active", "expired", "revoked"]), expiresAt: z.iso.datetime(),
  createdByName: z.string(), token: GroupInvitationTokenSchema.nullable(),
}).strict();
export const JoinGroupInvitationSchema = z.object({
  commandId: z.string().uuid(), tripId: z.string().uuid(), linkId: z.string().uuid(), version: z.number().int().positive(),
}).strict();
export type GroupInvitation = z.infer<typeof GroupInvitationSchema>;
export type GroupInvitationPreview = { tripId: string; linkId: string; version: number; tripName: string; inviterName: string; expiresAt: string };
