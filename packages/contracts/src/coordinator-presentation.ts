import { z } from 'zod';
const ids = z.array(z.string().min(1).max(100)).min(1).max(24);
export const CoordinatorUiBlockSchema = z.discriminatedUnion('component', [
  z.object({ component: z.literal('StayComparison'), props: z.object({ ids, focus: z.enum(['overview','price','location','notes']) }).strict() }).strict(),
  z.object({ component: z.literal('OpenQuestions'), props: z.object({ ids }).strict() }).strict(),
  z.object({ component: z.literal('Artifact'), props: z.object({ id: z.string().min(1).max(100) }).strict() }).strict(),
]);
export const CoordinatorUiSectionSchema = z.object({ component: z.literal('Section'), props: z.object({
  title: z.enum(['Comparison','Still to decide','Working draft','Evidence','Next step']), children: z.array(CoordinatorUiBlockSchema).min(1).max(6),
}).strict() }).strict();
export const CoordinatorUiViewSchema = z.object({ component: z.literal('Work'), props: z.object({ children: z.array(z.union([CoordinatorUiBlockSchema,CoordinatorUiSectionSchema])).min(1).max(6) }).strict() }).strict();
/** The model supplies only view. The authenticated host supplies scope, basis and status. */
export const CoordinatorPresentationSchema = z.object({
  schemaVersion: z.literal(1), tripId: z.string().uuid(), threadId: z.string().uuid(), turnId: z.string().uuid(),
  basis: z.string().max(80), status: z.enum(['ready','unavailable']), view: CoordinatorUiViewSchema.nullable(),
}).strict();
export type CoordinatorUiBlock = z.infer<typeof CoordinatorUiBlockSchema>;
export type CoordinatorUiView = z.infer<typeof CoordinatorUiViewSchema>;
export type CoordinatorPresentation = z.infer<typeof CoordinatorPresentationSchema>;
