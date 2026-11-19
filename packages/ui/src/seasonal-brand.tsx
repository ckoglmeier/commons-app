"use client";

import { useSyncExternalStore } from "react";
import { commonsBatPath, commonsBirdPaths, halloweenStartsAt, halloweenEndsAt, isHalloweenWeek } from "./brand";

function subscribe(onChange: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  function schedule() {
    const now = Date.now();
    const boundary = now < halloweenStartsAt ? halloweenStartsAt : halloweenEndsAt;
    if (now >= boundary) return;
    timer = setTimeout(() => { onChange(); schedule(); }, Math.min(boundary - now + 1, 2_147_483_647));
  }
  schedule();
  return () => clearTimeout(timer);
}
const snapshot = () => isHalloweenWeek(Date.now());
const serverSnapshot = () => false;

/** Stable server/hydration markup; the seasonal accent is browser-only. */
export function SeasonalBrandPaths() {
  const halloween = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return halloween
    ? <path d={commonsBatPath} fill="currentColor" />
    : <>{commonsBirdPaths.map((d) => <path key={d} d={d} fill="currentColor" />)}</>;
}
