import { createHash } from "node:crypto";

/** Spam limits for in-context feedback (BR-10). Bounds per trip or surface per hour, across the deployment, and a short duplicate window. */
export const FEEDBACK_LIMITS = { perContextPerHour: 8, globalPerHour: 300, duplicateWindowMs: 10 * 60_000 } as const;

export type FeedbackDecision = "allow" | "duplicate" | "limited";

export function feedbackDecision(input: { recentInContext: number; recentGlobal: number; duplicateRecent: boolean }): FeedbackDecision {
  if (input.duplicateRecent) return "duplicate";
  if (input.recentInContext >= FEEDBACK_LIMITS.perContextPerHour || input.recentGlobal >= FEEDBACK_LIMITS.globalPerHour) return "limited";
  return "allow";
}

/** A stable, non-reversible fingerprint of a message so an accidental double send can be recognized without comparing text in logs. */
export function feedbackFingerprint(message: string) {
  return createHash("sha256").update(message.trim().toLowerCase().replace(/\s+/g, " ")).digest("hex").slice(0, 32);
}
