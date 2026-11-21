import "server-only";
import { buildMoneySummary } from "../money-summary";
import { loadCommonsSnapshot } from "./commons";

export async function loadMoneySummary(identifier: string) {
  // Reuse the active-member boundary for every request, before projecting any ledger fields.
  const snapshot = await loadCommonsSnapshot(identifier);
  return snapshot ? buildMoneySummary(snapshot, new Date().toISOString()) : null;
}
