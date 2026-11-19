"use client";

import { useRef, useState } from "react";

export function ProfileNotifications({ initialDailyDigestEnabled, initialEvents = [] }: {
  initialDailyDigestEnabled: boolean;
  initialEvents?: Array<{ eventId: string; name: string; enabled: boolean }>;
}) {
  const [enabled, setEnabled] = useState(initialDailyDigestEnabled);
  const [events, setEvents] = useState(initialEvents);
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function updatePreference(nextEnabled: boolean) {
    if (inFlight.current) return;
    inFlight.current = true;
    const previousEnabled = enabled;
    setEnabled(nextEnabled);
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/v1/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dailyDigestEnabled: nextEnabled }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Couldn’t save your email settings. Try again.");
      setEnabled(payload.dailyDigestEnabled);
      setMessage(payload.dailyDigestEnabled ? "Daily summaries are on." : "Daily summaries are off.");
    } catch (error) {
      setEnabled(previousEnabled);
      setMessage(error instanceof Error ? error.message : "Couldn’t save your email settings. Try again.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  async function updateEvent(eventId: string, nextEnabled: boolean) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true); setMessage("");
    const name = events.find(event => event.eventId === eventId)?.name ?? "Event";
    try {
      const response = await fetch("/api/v1/profile/event-digests", { method: "PATCH",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ eventId, enabled: nextEnabled }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Couldn’t save that choice. Try again.");
      setEvents(current => current.map(event => event.eventId === eventId ? { ...event, enabled: payload.enabled } : event));
      setMessage(`${name}: daily summary ${payload.enabled ? "on" : "off"}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Couldn’t save that choice. Try again.");
    } finally { inFlight.current = false; setPending(false); }
  }

  return (
    <section className="profile-notifications" aria-labelledby="profile-notifications-heading">
      <span className="view-kicker">Notifications</span>
      <h2 id="profile-notifications-heading">Daily summary</h2>
      <p>One email with what changed. No email on quiet days.</p>
      <div className="profile-notification-row">
        <span><label htmlFor="daily-digest-enabled">Email me a daily summary</label><small>Doesn’t change invitation, sign-in, or poll emails.</small></span>
        <input
          type="checkbox"
          id="daily-digest-enabled"
          role="switch"
          checked={enabled}
          disabled={pending}
          aria-describedby="profile-notification-status"
          onChange={(event) => void updatePreference(event.target.checked)}
        />
      </div>
      {events.length ? <div className="event-digest-preferences">
        <h3>Choose your trips</h3>
        <p>Turn an event back on to get new updates only.</p>
        {!enabled ? <p>Daily summaries are off. Your event choices are saved.</p> : null}
        {events.map(event => <div className="profile-notification-row" key={event.eventId}>
          <span><label htmlFor={`event-digest-${event.eventId}`}>{event.name}</label><small>Include in my summary</small></span>
          <input id={`event-digest-${event.eventId}`} type="checkbox" role="switch" checked={event.enabled}
            disabled={!enabled || pending} aria-describedby="profile-notification-status"
            onChange={e => void updateEvent(event.eventId, e.target.checked)} />
        </div>)}
      </div> : null}
      <small id="profile-notification-status" role="status" aria-live="polite">
        {pending ? "Saving…" : message}
      </small>
    </section>
  );
}
