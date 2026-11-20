"use client";

import { EventAttendanceSchema, type EventAttendance, type CommonsParticipant } from "@commons/contracts";
import { PeopleResults } from "./people-results";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { personFacingError } from "@/lib/person-facing-error";

const labels = { helping: "Helping plan", attending: "Attending", declined: "Declined", needs_confirmation: "Dates changed · please confirm again" };

export function EventAttendancePanel({ eventId, readOnly = false, participants = [], onSaved, context = "people" }: { eventId: string; readOnly?: boolean; participants?: CommonsParticipant[]; onSaved?: () => void; context?: "people" | "conversation" }) {
  const router = useRouter();
  const [data, setData] = useState<EventAttendance | null>(null);
  const [error, setError] = useState("");
  const [review, setReview] = useState<"declined" | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const command = useRef<string | null>(null);
  const busy = useRef(false);
  const headingId = useId();
  const [changing, setChanging] = useState(false);
  const endpoint = `/api/v1/commons/${encodeURIComponent(eventId)}/attendance`;
  function reloadAttendance() {
    setData(null); setError(""); setReview(null); setSaved(false); command.current = null; setReloadVersion(value => value + 1);
  }
  useEffect(() => {
    const refresh = (event: Event) => { if ((event as CustomEvent<string>).detail === eventId) setReloadVersion(value => value + 1); };
    window.addEventListener("commons-attendance-saved", refresh);
    return () => window.removeEventListener("commons-attendance-saved", refresh);
  }, [eventId]);
  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint, { signal: controller.signal, cache: "no-store" }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Attendance unavailable.");
      setData(EventAttendanceSchema.parse(body));
    }).catch(cause => { if (!controller.signal.aborted) setError(personFacingError(cause, "Attendance unavailable.")); });
    return () => controller.abort();
  }, [endpoint, reloadVersion]);
  async function save(answer: "helping" | "attending" | "declined" | null = review) {
    if (!data || !answer || busy.current) return;
    busy.current = true; setSaving(true); setError("");
    command.current ??= crypto.randomUUID();
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commandId: command.current, state: answer, reviewedDates: data.dates }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Attendance not saved.");
      if (answer === "declined") { router.replace("/trips"); router.refresh(); return; }
      setData({ ...data, people: data.people.map(person => person.personId === data.currentPersonId ? { ...person, state: answer } : person) });
      setReview(null); setChanging(false); command.current = null; setSaved(true); onSaved?.();
      window.dispatchEvent(new CustomEvent("commons-attendance-saved", { detail: eventId }));
    } catch (cause) { setError(personFacingError(cause, "Attendance not saved. Try again.")); }
    finally { busy.current = false; setSaving(false); }
  }
  if (readOnly) return <><PeopleResults participants={participants} attendance={data} />{error ? <p role="status">Attendance unavailable. Joined status is shown instead.</p> : null}</>;
  if (!data && error) return <div><p role="alert">{error}</p><button type="button" className="cm-action" onClick={reloadAttendance}>Reload attendance</button></div>;
  const currentState = data?.people.find(person => person.personId === data.currentPersonId)?.state ?? "helping";
  const needsResponse = Boolean(data?.startsOn && data?.endsOn && (currentState === "helping" || currentState === "needs_confirmation"));
  if (context === "conversation" && (!needsResponse || saved)) return null;
  const showActions = context === "conversation" || changing;
  const dateLabel = (date: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
  const dates = data?.startsOn && data?.endsOn ? `${dateLabel(data.startsOn)} – ${dateLabel(data.endsOn)}` : "Dates not set.";
  return <section className="trip-details-group event-attendance-editor" aria-labelledby={headingId}>
    <div className="trip-details-heading"><h3 id={headingId}>Your attendance</h3></div>
    {!data && !error ? <p role="status">Loading attendance…</p> : null}
    {data ? <>
      <p>{labels[data.people.find(person => person.personId === data.currentPersonId)?.state ?? "helping"]}</p>
      <p>{dates}</p>
      {!showActions ? <button className="text-action cm-action" type="button" onClick={() => setChanging(true)}>Change response</button> : <div className="fieldnotes-actions">{(["helping", "attending", "declined"] as const).map(state => <button type="button" key={state} disabled={saving || (state === "attending" && (!data.startsOn || !data.endsOn))} onClick={() => { command.current = null; setSaved(false); if (state === "declined") setReview(state); else void save(state); }}>{state === "helping" ? "Still deciding" : state === "attending" ? "I’m attending" : "I can’t attend"}</button>)}{context === "people" ? <button type="button" disabled={saving} onClick={() => { setChanging(false); setReview(null); }}>Done</button> : null}</div>}
      {review ? <div className="fieldnotes-question"><h4>Decline this trip?</h4>
        <p>You’ll lose access to this trip and its future updates. Your past contributions stay attributed to you. You’ll need a new invitation to rejoin. Skipping an optional activity doesn’t mean leaving the trip.</p>
        <div className="fieldnotes-actions"><button type="button" disabled={saving} onClick={() => { setReview(null); command.current = null; }}>Cancel</button><button type="button" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Decline and leave trip"}</button></div>
      </div> : null}
    </> : null}
    {saved ? <p role="status">Attendance saved.</p> : null}
    {error ? <><p role="alert">{error}</p><div className="fieldnotes-actions"><button type="button" disabled={saving} onClick={reloadAttendance}>Reload attendance</button></div></> : null}
  </section>;
}
