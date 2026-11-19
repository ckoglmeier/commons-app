"use client";
import { useEffect, useRef, useState } from "react";
import { WorkspaceResearchTasksSchema, type WorkspaceResearchTask } from "@commons/contracts";

export function CoordinatorResearchTasks({ slug, threadId, onComplete, runnerOperating = false }: { slug: string; threadId: string; onComplete: () => void; /** Only an operating runner makes "continues after you leave" true. */ runnerOperating?: boolean }) {
  const [query, setQuery] = useState("");
  const [tasks, setTasks] = useState<WorkspaceResearchTask[]>([]);
  const [error, setError] = useState("");
  const [progressError, setProgressError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef<{ query: string; commandId: string } | null>(null);
  const complete = useRef(onComplete);
  useEffect(() => { complete.current = onComplete; }, [onComplete]);
  const endpoint = `/api/v1/commons/${encodeURIComponent(slug)}/coordinator/research`;
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    let previous = "";
    async function poll() {
      try {
        const response = await fetch(`${endpoint}?threadId=${threadId}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Research progress couldn’t refresh. Reconnecting shortly.");
        const next = WorkspaceResearchTasksSchema.parse(await response.json());
        if (stopped) return;
        setTasks(next); setProgressError("");
        const succeeded = next.filter(task => task.status === "succeeded").map(task => task.taskId).join();
        if (succeeded && succeeded !== previous) complete.current();
        previous = succeeded;
      } catch { if (!stopped) setProgressError("Research progress couldn’t refresh. Reconnecting shortly."); }
      finally { if (!stopped) timer = setTimeout(poll, 5000); }
    }
    void poll();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, [endpoint, threadId, refresh]);
  async function submit() {
    if (busy || !query.trim()) return;
    setBusy(true); setError("");
    const text = query.trim();
    if (pending.current?.query !== text) pending.current = { query: text, commandId: crypto.randomUUID() };
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...pending.current, threadId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Research couldn’t be queued.");
      setQuery(""); pending.current = null; setRefresh(value => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Connection interrupted. Check the task list or retry this query."); }
    finally { setBusy(false); }
  }
  async function cancel(taskId: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch(endpoint, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ threadId, taskId }) });
      if (!response.ok) throw new Error("Cancellation wasn’t confirmed. Check the task status before retrying.");
      setRefresh(value => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Cancellation wasn’t confirmed."); }
    finally { setBusy(false); }
  }
  return <section className="workspace-work-section workspace-research" aria-label="Background research">
    <h3>Research this topic</h3>
    <label>Public search query<input value={query} onChange={event => setQuery(event.target.value)} maxLength={500} disabled={busy} placeholder="Small hotels in Sonoma" /></label>
    <p className="review-caption">Only this query goes to the search provider. Leave out names and private details. {runnerOperating ? "Research continues after you leave; results stay with this topic for organizers." : "Research runs only while a task runner is operating. None is confirmed here, so a query may wait until one runs; results stay with this topic for organizers."} No bookings or plan changes.</p>
    <button type="button" className="cm-action" disabled={busy || !query.trim()} onClick={() => void submit()}>Start research</button>
    {error || progressError ? <p role="alert">{error || progressError}</p> : null}
    <div role="status" aria-live="polite">{tasks.some(task => task.status === "pending" || task.status === "processing") ? (runnerOperating ? "Research is in progress. You can leave this page." : "Research is queued or in progress. It only advances while a task runner is operating, so check back here.") : null}</div>
    {tasks.map(task => <section key={task.taskId}><strong>{task.query}</strong><p className="review-caption">{task.status === "pending" ? task.errorCode ? "Waiting to retry" : "Queued" : task.status === "processing" ? "Reading sources" : task.status === "succeeded" ? "Research finished · Review sources and limitations below" : task.status === "cancelled" ? "Cancelled" : "Research stopped · You can submit a new query"}</p>{task.status === "pending" || task.status === "processing" ? <button type="button" className="cm-action" disabled={busy} onClick={() => void cancel(task.taskId)}>Cancel research</button> : null}</section>)}
  </section>;
}
