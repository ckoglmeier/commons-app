import { z } from "zod";

/** Private execution data, never a permission or an analytics payload. */
export type WorkflowJson = null | boolean | number | string | WorkflowJson[] | { [key: string]: WorkflowJson };
export const WORKFLOW_EXECUTION_BYTES = 512_000;
function boundedJsonObject(value: unknown): value is Record<string, WorkflowJson> {
  const seen = new Set<object>(); let nodes = 0;
  const visit = (item: unknown, depth: number): boolean => {
    if (++nodes > 30_000 || depth > 24) return false;
    if (item === null || typeof item === "boolean" || typeof item === "string") return true;
    if (typeof item === "number") return Number.isFinite(item);
    if (typeof item !== "object" || seen.has(item)) return false;
    seen.add(item);
    let valid: boolean;
    if (Array.isArray(item)) valid = item.length <= 500 && item.every(x => visit(x, depth + 1));
    else if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) valid = false;
    else { const keys = Object.keys(item); valid = keys.length <= 500 && keys.every(key => !["__proto__", "prototype", "constructor"].includes(key) && visit((item as Record<string, unknown>)[key], depth + 1)); }
    seen.delete(item); return valid;
  };
  return Boolean(value && !Array.isArray(value) && typeof value === "object" && visit(value, 0)
    && new TextEncoder().encode(JSON.stringify(value)).length <= WORKFLOW_EXECUTION_BYTES);
}
export const WorkflowPayloadSchema = z.custom<Record<string, WorkflowJson>>(boundedJsonObject, "Expected bounded, plain JSON object.");
const version = z.number().int().positive();
const key = z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/);
export const WorkflowArtifactRefSchema = z.object({ kind: z.enum(["research_decision", "itinerary_draft", "poll_draft"]), id: z.string().uuid(), revision: z.number().int().nonnegative() }).strict();
export type WorkflowArtifactRef = z.infer<typeof WorkflowArtifactRefSchema>;
export const WorkflowExecutionPinsSchema = z.object({
  goalRevision: version, briefRevision: version, contextVersion: z.string().regex(/^[a-f0-9]{64}$/),
  recipe: z.object({ key, version, digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  policyVersion: z.string().min(1).max(80),
  /** Lookup pin for the atomic human review command, not a bearer approval token. */
  inputReview: z.object({ commandId: z.string().uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict().optional(),
}).strict();
export type WorkflowExecutionPins = z.infer<typeof WorkflowExecutionPinsSchema>;
export const WorkflowExecutionSchema = z.object({
  version: z.literal(1), revision: version,
  handler: z.object({ key, version }).strict(), artifact: WorkflowArtifactRefSchema,
  pins: WorkflowExecutionPinsSchema,
  /** Server-supplied domain brief, not the whole thread. Review authority requires
   * a validated durable inputReview pin; legacy fixture input may be unsigned. */
  input: WorkflowPayloadSchema,
  checkpoint: z.object({ revision: version, value: WorkflowPayloadSchema }).strict().nullable(),
  comparison: z.object({ revision: version, value: WorkflowPayloadSchema }).strict().nullable(),
  checkpointChecksum: z.string().regex(/^[a-f0-9]{64}$/).nullable(), comparisonChecksum: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  status: z.enum(["running", "needs_input", "ready", "failed"]),
  budget: z.object({ maxCalls: z.number().int().min(0).max(20), maxSteps: z.number().int().min(1).max(64), spendCents: z.literal(0), deadlineAt: z.string().datetime() }).strict(),
  usage: z.object({ calls: z.number().int().min(0).max(20), steps: z.number().int().min(0).max(64), reservedCents: z.number().int().nonnegative() }).strict(),
  /** Outstanding calls are never automatically refunded or repeated after lease loss. */
  reservations: z.array(z.object({ id: z.string().uuid(), toolId: key, attemptId: z.string().uuid(), status: z.enum(["reserved", "completed", "uncertain"]), upperBoundCents: z.number().int().nonnegative() }).strict()).max(20),
  correlation: z.object({ commandId: z.string().uuid(), traceId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/).nullable() }).strict(),
}).strict().superRefine((execution, ctx) => {
  if (new TextEncoder().encode(JSON.stringify(execution)).length > WORKFLOW_EXECUTION_BYTES) ctx.addIssue({ code: "custom", message: "Workflow execution exceeds the total byte bound." });
  if (execution.usage.calls !== execution.reservations.length || new Set(execution.reservations.map(r => r.id)).size !== execution.reservations.length)
    ctx.addIssue({ code: "custom", message: "Reservation ledger mismatch." });
});
export type WorkflowExecution = z.infer<typeof WorkflowExecutionSchema>;
