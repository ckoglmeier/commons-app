/** Internal accounts are excluded before any browser or AI event is sent. */
const excludedEmails = new Set([
  'organizer@example.com',
  'organizer+commons-beta-qa@example.com',
]);
/** The same internal accounts, for server-side report exclusion (daily-analytics.ts). */
export const internalAnalyticsEmails: readonly string[] = [...excludedEmails];

export function isPosthogExcluded(email: string | null | undefined): boolean {
  return Boolean(email && excludedEmails.has(email.trim().toLowerCase()));
}
