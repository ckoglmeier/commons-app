"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { SaveTripTaskSchema, TripTaskSchema, type TripTask } from "@commons/contracts";
import { CoordinatorMark } from "@commons/ui";
import { organizerEarlyQuestions, organizerEarlySteps, organizerEarlyTaskIds, type EarlyTaskIds } from "@/lib/organizer-getting-started";
import type { TripTaskContext } from "./trip-tasks";

type Answer = "open" | "done" | "unneeded";
const pendingSchema = z.object({ key: z.enum(["dates", "location", "lodging", "transport", "people", "budget"]), answer: z.enum(["open", "done", "unneeded"]), body: SaveTripTaskSchema });
type Pending = z.infer<typeof pendingSchema>;

/** A human-led check-in. Answers save ordinary tasks through the existing receipt API. */
export function OrganizerGettingStarted({ slug, actorId, context, autoStart = false, reopen = false, onClose }: {
  slug: string; actorId: string; context: TripTaskContext; autoStart?: boolean; reopen?: boolean; onClose?: () => void;
}) {
  const [open, setOpen] = useState(autoStart || reopen);
  const [data, setData] = useState<{ ids: EarlyTaskIds; tasks: TripTask[]; today: string } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState<Pending | null>(null);
  const pending = useRef<Pending | null>(null);
  const saving = useRef(false);
  const reload = useRef<() => Promise<void>>(async () => {});
  const storageKey = `commons:${context.commons.id}:${actorId}:early-tasks`;
  const endpoint = `/api/v1/commons/${encodeURIComponent(slug)}/tasks`;

  useEffect(() => {
    let live = true;
    async function load() {
      try {
        const [ids, response] = await Promise.all([organizerEarlyTaskIds(context.commons.id), fetch(endpoint, { cache: "no-store" })]);
        if (!response.ok) throw new Error("Your tasks couldn’t load. Try again before continuing.");
        const tasks = z.array(TripTaskSchema).parse((await response.json()).tasks);
        const today = new Intl.DateTimeFormat("en-CA", { timeZone: context.commons.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
        if (!live) return;
        setData({ ids, tasks, today });
        setError("");
        try {
          if (!reopen && window.sessionStorage.getItem(`${storageKey}:paused`)) setOpen(false);
          const stored = pendingSchema.safeParse(JSON.parse(window.sessionStorage.getItem(`${storageKey}:request`) ?? "null"));
          if (stored.success && stored.data.body.id === ids[stored.data.key] && stored.data.body.ownerPersonId === actorId) {
            pending.current = stored.data;
          }
        } catch { /* Optional private session storage. */ }
        if (pending.current && tasks.some(task => task.id === pending.current?.body.id)) {
          pending.current = null;
          setRetry(null);
          try { window.sessionStorage.removeItem(`${storageKey}:request`); } catch { /* Optional private session storage. */ }
        } else setRetry(pending.current);
      } catch {
        if (live) setError("Your tasks couldn’t load. Try again before continuing.");
      }
    }
    reload.current = load;
    void load();
    const changed = () => { if (!saving.current) void load(); };
    window.addEventListener("commons:trip-tasks-changed", changed);
    window.addEventListener("focus", changed);
    return () => { live = false; window.removeEventListener("commons:trip-tasks-changed", changed); window.removeEventListener("focus", changed); };
  }, [actorId, context.commons.id, context.commons.timezone, endpoint, storageKey, reopen]);

  const questions = data ? organizerEarlyQuestions(context.commons, context.state, data.tasks, data.ids, data.today) : [];
  const step = retry ? organizerEarlySteps.find(item => item.key === retry.key) : questions[0];
  if (!context.organizer || context.state.commonsId !== context.commons.id || context.commons.status === "closing" || context.commons.status === "archived" || (data && context.commons.endsOn && context.commons.endsOn < data.today)) return null;

  function toggle(value: boolean) {
    setOpen(value);
    try {
      if (value) window.sessionStorage.removeItem(`${storageKey}:paused`);
      else window.sessionStorage.setItem(`${storageKey}:paused`, "1");
    } catch { /* Optional private session storage. */ }
    if (!value) onClose?.();
  }

  async function answer(choice: Answer) {
    if (!step || !data || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const request = pending.current ?? { key: step.key, answer: choice, body: {
      commandId: crypto.randomUUID(), id: data.ids[step.key], expectedVersion: 0,
      title: choice === "unneeded" ? `Review ${step.key === "transport" ? "transportation" : step.key} needs (not needed)` : step.title,
      ownerPersonId: actorId, dueOn: null, completed: choice !== "open", itemKind: null, itemId: null,
    } };
    pending.current = request;
    try {
      try { window.sessionStorage.setItem(`${storageKey}:request`, JSON.stringify(request)); } catch { /* Mounted request still survives retries. */ }
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request.body) });
      const value = await response.json();
      if (!response.ok) {
        if (response.status === 409) {
          await reload.current();
          if (!pending.current) {
            setNotice("This decision already has a saved Task. Its owner and completion state were kept.");
            window.dispatchEvent(new Event("commons:trip-tasks-changed"));
            return;
          }
        }
        throw new Error(typeof value.error === "string" ? value.error : "The task couldn’t save. Retry your answer.");
      }
      const task = TripTaskSchema.parse(value.task);
      if (task.id !== request.body.id) throw new Error("The task couldn’t be verified. Retry your answer.");
      pending.current = null;
      setRetry(null);
      try { window.sessionStorage.removeItem(`${storageKey}:request`); } catch { /* Optional private session storage. */ }
      setData(current => current ? { ...current, tasks: [...current.tasks.filter(item => item.id !== task.id), task] } : current);
      setNotice(task.completed ? `Saved a completed task: ${task.title}.` : `Added to your Tasks: ${task.title}.`);
      window.dispatchEvent(new Event("commons:trip-tasks-changed"));
    } catch (cause) {
      setRetry(pending.current);
      setError(cause instanceof Error ? cause.message : "The task couldn’t save. Retry your answer.");
    } finally { saving.current = false; setBusy(false); }
  }

  if (!open) return null;
  return <section className="workspace-guide workspace-check-in" aria-label="Organizer getting started">
    <span className="review-coordinator"><CoordinatorMark aria-hidden="true" /> Commons</span>
    <h2>{data && step ? step.question : "Where things stand"}</h2>
    {error ? <p role="alert">{error}</p> : null}
    {!data ? <>{!error ? <p className="review-caption">Checking your tasks…</p> : <button className="cm-action" type="button" onClick={() => void reload.current()}>Try again</button>}</> : step ? <>
      <p className="review-caption">Each answer saves a task. Trip details don’t change.</p>
      <div className="workspace-starters" role="group" aria-label={step.question}>
        {retry ? <button className="cm-action" type="button" disabled={busy} onClick={() => void answer(retry.answer)}>{busy ? "Saving…" : "Retry this answer"}</button> : <>
          <button className="cm-action" type="button" disabled={busy || Boolean(error)} onClick={() => void answer("open")}>{busy ? "Saving…" : "Not yet, add task"}</button>
          <button className="cm-action" type="button" disabled={busy || Boolean(error)} onClick={() => void answer("done")}>Yes, mark done</button>
          {step.optional ? <button className="cm-action" type="button" disabled={busy || Boolean(error)} onClick={() => void answer("unneeded")}>Not needed</button> : null}
        </>}
        <button className="cm-action" type="button" disabled={busy} onClick={() => toggle(false)}>Not now</button>
      </div>
      <details><summary>How this works</summary><p className="review-caption">We’ll go through dates, location, lodging, transportation, people, and budget, skipping what’s saved. Yes and Not needed record a completed task.</p></details>
      {error && !retry ? <button className="cm-action" type="button" onClick={() => void reload.current()}>Try again</button> : null}
    </> : <p>The early decisions are accounted for in saved details or Tasks. Unfinished to-dos are in Tasks.</p>}
    {notice ? <p role="status">{notice}</p> : null}
    {!data || !step ? <button className="cm-action" type="button" disabled={busy} onClick={() => toggle(false)}>{data && !step ? "Close check-in" : "Not now"}</button> : null}
  </section>;
}
