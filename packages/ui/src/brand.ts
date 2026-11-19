/** Bird A: the approved two-stroke flight mark. All exported artwork uses these paths. */
export const commonsBirdViewBox = "0 0 64 64";
export const commonsBirdPaths = [
  "M27.8 3C35.8 10.2 45.5 21.3 45.5 27.8C45.5 40.8 29.5 53.7 6 52.3C22.6 50.2 37.6 43.4 38.9 33C40.4 22.7 33.6 10.9 27.8 3Z",
  "M19.7 60.7C36.4 56.5 39.4 38.9 48.7 34.7C52.4 33 56 33.6 58.2 34.3C48.2 39.4 42.3 52.7 25.5 59.4C23.5 60.2 21.5 60.8 19.7 60.7Z",
] as const;

/** One-off Halloween week, through Sunday Nov 1 (America/Denver). */
export const halloweenStartsAt = Date.parse("2026-10-26T00:00:00-06:00");
export const halloweenEndsAt = Date.parse("2026-11-02T00:00:00-07:00");
export function isHalloweenWeek(now: number) {
  return now >= halloweenStartsAt && now < halloweenEndsAt;
}

/** Small, faceless bat; shares the bird's 64px canvas and currentColor. */
export const commonsBatPath = "M3 18Q13 24 24 29L27 18L32 23L37 18L40 29Q51 24 61 18Q57 30 60 39Q50 33 45 44Q38 38 32 51Q26 38 19 44Q14 33 4 39Q7 30 3 18Z";
