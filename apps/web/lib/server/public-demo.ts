import type { CommonsSnapshot } from "@commons/contracts";

export function createPublicDemoSnapshotLookup(snapshot: CommonsSnapshot) {
  return new Map([
    [snapshot.commons.id, snapshot] as const,
    [snapshot.commons.slug, snapshot] as const,
  ]);
}
