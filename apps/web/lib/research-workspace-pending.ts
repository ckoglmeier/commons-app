import type { ResearchWorkspaceStart } from "./server/research-workspace-service";
/** Browser journal only, not approval or execution authority. Keep the exact
 * command and request before sending. Unknown transport never mints a new ID. */
export type ResearchPending = { version: 1; body: ResearchWorkspaceStart };
export function researchPendingKey(slug: string, actorId: string) { return `commons:${slug}:${actorId}:reviewed-research-pending`; }
export function readResearchPending(raw: string | null): ResearchPending | null {
  if (raw === null) return null;
  if (raw.length > 32_000) throw new Error("Research recovery record is unreadable.");
  const value = JSON.parse(raw) as ResearchPending;
  if (value?.version !== 1 || !value.body || !/^[0-9a-f-]{36}$/i.test(value.body.commandId)
    || !/^[0-9a-f]{64}$/.test(value.body.expectedSourceFingerprint) || !value.body.selection || !value.body.request) throw new Error("Research recovery record is unreadable.");
  return value;
}
