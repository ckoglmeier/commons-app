"use client";
import { useEffect, useState } from "react";
import { CoordinatorTasksSchema, type CoordinatorTask } from "@commons/contracts";

/** Read the existing authorized task endpoints; never infer tasks from conversation text. */
export function useOverviewLegacyTasks(slug: string, threadIds: string[], enabled: boolean) {
  const [state, setState] = useState<{ tasks: CoordinatorTask[]; unavailable: boolean; key: string }>({ tasks: [], unavailable: true, key: "" });
  const scope = JSON.stringify([...threadIds].sort());
  const key = `${slug}:${scope}`;
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let generation = 0;
    const load = async () => {
      const request = ++generation;
      try {
        const batches = await Promise.all((JSON.parse(scope) as string[]).map(async id => {
          const response = await fetch(`/api/v1/commons/${encodeURIComponent(slug)}/coordinator/tasks?threadId=${encodeURIComponent(id)}`, { cache: "no-store" });
          if (!response.ok) throw new Error("unavailable");
          return CoordinatorTasksSchema.parse((await response.json()).tasks);
        }));
        if (active && request === generation) setState({ tasks: batches.flat(), unavailable: false, key });
      } catch { if (active && request === generation) setState({ tasks: [], unavailable: true, key }); }
    };
    void load();
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [slug, scope, key, enabled]);
  return enabled ? state.key === key ? { ...state, loading: false } : { tasks: [], unavailable: false, loading: true } : { tasks: [], unavailable: false, loading: false };
}
