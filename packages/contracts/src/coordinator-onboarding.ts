import { z } from 'zod';
import { CoordinatorPersonalitySelectionSchema } from './coordinator-personality';
export const SetupCoordinatorStateSchema = z.object({
    personality: CoordinatorPersonalitySelectionSchema.default({ id: 'commons', specificationVersion: 1 }),
    startingPoint: z.string().trim().min(1).max(120).nullable().default(null),
    turns: z.array(z.object({ commandId: z.string().uuid(), prompt: z.string().max(1800), reply: z.string().max(32000).nullable(), personality: CoordinatorPersonalitySelectionSchema, at: z.string().datetime() })).max(30).default([]),
}).default({ personality: { id: 'commons', specificationVersion: 1 }, startingPoint: null, turns: [] });
export const SetupCoordinatorRequestSchema = z.discriminatedUnion('action', [
    z.object({ action: z.literal('message'), expectedVersion: z.number().int().positive(), commandId: z.string().uuid(), prompt: z.string().trim().min(1).max(1800) }).strict(),
    z.object({ action: z.literal('configure'), expectedVersion: z.number().int().positive(), personality: CoordinatorPersonalitySelectionSchema, startingPoint: z.string().trim().min(1).max(120).nullable() }).strict(),
]);
export const CoordinatorSettingsSchema = z.object({ version: z.number().int().nonnegative().default(0), personality: CoordinatorPersonalitySelectionSchema.default({ id: 'commons', specificationVersion: 1 }) });
export const CoordinatorSettingsRequestSchema = z.discriminatedUnion('action', [
    z.object({ action: z.literal('personality'), commandId: z.string().uuid(), expectedVersion: z.number().int().nonnegative(), personality: CoordinatorPersonalitySelectionSchema }).strict(),
    z.object({ action: z.literal('dismiss') }).strict(),
]);
export type SetupCoordinatorState = z.infer<typeof SetupCoordinatorStateSchema>;
