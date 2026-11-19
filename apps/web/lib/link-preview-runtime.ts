const october2026PatchedVersions = new Map<number, readonly [number, number]>([
  [22, [23, 4]],
  [24, [22, 1]],
  [26, [12, 1]],
]);

export function hasOctober2026NodeSecurityPatches(version: string) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  const minimum = october2026PatchedVersions.get(major);
  if (!minimum) return false;
  return minor > minimum[0] || (minor === minimum[0] && patch >= minimum[1]);
}
