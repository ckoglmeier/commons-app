import { getDestination } from '../destinations';

/** Compatibility helper: the worksheet now appears on every real destination. */
export function showsBudgetWorksheet(slug: string): boolean {
  return getDestination(slug) !== undefined;
}
