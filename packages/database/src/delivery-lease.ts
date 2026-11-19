// Both delivery workers use monotonically increasing attempt numbers as leases.
// Completion must match the current number and an unexpired processing lease.
export const DELIVERY_MAX_ATTEMPTS = 5;
export const DELIVERY_LEASE_MS = 5 * 60_000;
export const DELIVERY_RETRY_MS = 5 * 60_000;
export const DELIVERY_MAX_AGE_MS = 24 * 60 * 60_000;

export function ownsDeliveryLease(
  row: { status: string; attempts: number; leaseExpiresAt: Date | null },
  attempt: number,
  now: Date,
) {
  return (row.status === "processing" || row.status === "leased")
    && row.attempts === attempt && Boolean(row.leaseExpiresAt && row.leaseExpiresAt > now);
}
