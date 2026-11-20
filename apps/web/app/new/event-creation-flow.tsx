"use client";
import Link from "next/link";

import {
  SendSetupInvitationsResultSchema,
  type EventBrief,
  type EventCreationDraft,
  type RecentReusableEvent,
} from "@commons/contracts";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { PLAN_TEMPLATES } from "@commons/domain";
import { commonsPath } from "@/lib/commons-route";
import { trackProductEvent } from "@/lib/product-analytics";
import { tripEntrySignInPath, type TripEntryContext } from "@/lib/trip-entry/context";
import { errorKind, personFacingError } from "@/lib/person-facing-error";

type Stage = "entry" | "setup" | "people" | "review";

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init.headers } });
  const payload = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "That didn’t save. Try again.");
  return payload as T;
}

const lines = (value: string) => value.split("\n").map((item) => item.trim()).filter(Boolean);
const joined = (value: string[]) => value.join("\n");
const dollars = (cents: number | null) => cents === null ? "" : String(cents / 100);
const cents = (value: string) => value.trim() && Number.isFinite(Number(value)) ? Math.round(Number(value) * 100) : null;

function dateLabel(startsOn: string | null, endsOn: string | null) {
  if (!startsOn && !endsOn) return "Dates to be decided";
  const format = (value: string) => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
  if (startsOn && endsOn) return startsOn === endsOn ? format(startsOn) : `${format(startsOn)}–${format(endsOn)}`;
  return format((startsOn ?? endsOn)!);
}

function Progress({ stage }: { stage: Exclude<Stage, "entry"> }) {
  const steps: Array<{ key: Exclude<Stage, "entry">; label: string }> = [
    { key: "setup", label: "Setup" }, { key: "people", label: "People" }, { key: "review", label: "Review" },
  ];
  const active = steps.findIndex((step) => step.key === stage);
  return <nav className="setup-progress" aria-label="Trip setup progress"><ol>{steps.map((step, index) => (
    <li className={index === active ? "active" : index < active ? "complete" : ""} aria-current={index === active ? "step" : undefined} key={step.key}>
      <span>{index + 1}</span><strong>{step.label}</strong>
    </li>
  ))}</ol></nav>;
}

export function EventCreationFlow({ signedIn, initialRecentEvents, initialDraft, initialTemplateKey, entry }: {
  initialTemplateKey: string;
  entry: { entryContext: TripEntryContext; requestedDraftId: string | null; draftLoadFailed: boolean };
  signedIn: boolean; initialRecentEvents: RecentReusableEvent[]; initialDraft: EventCreationDraft | null;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(initialDraft);
  const [stage, setStage] = useState<Stage>(initialDraft ? "setup" : "entry");
  const [title, setTitle] = useState("");
  const [templateKey, setTemplateKey] = useState(initialTemplateKey);
  const [name, setName] = useState(initialDraft?.proposedName ?? "");
  const [location, setLocation] = useState(initialDraft?.locationName ?? "");
  const [startsOn, setStartsOn] = useState(initialDraft?.startsOn ?? "");
  const [endsOn, setEndsOn] = useState(initialDraft?.endsOn ?? "");
  const [goals, setGoals] = useState(joined(initialDraft?.brief.goals ?? []));
  const [constraints, setConstraints] = useState(joined(initialDraft?.brief.constraints ?? []));
  const [budgetMinimum, setBudgetMinimum] = useState(dollars(initialDraft?.brief.budgetMinimumCents ?? null));
  const [budgetMaximum, setBudgetMaximum] = useState(dollars(initialDraft?.brief.budgetMaximumCents ?? null));
  const [people, setPeople] = useState(initialDraft?.people ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [committedEventId, setCommittedEventId] = useState(initialDraft?.committedEventId ?? null);
  const [committedSlug, setCommittedSlug] = useState(initialDraft?.committedEventSlug ?? null);

  useEffect(() => { trackProductEvent("event_creation_viewed"); }, []);

  const brief = useMemo<EventBrief>(() => ({
    ...(draft?.brief ?? { summary: null, budgetMinimumCents: null, budgetMaximumCents: null, currency: null, suggestedFirstMoves: [], unresolvedQuestion: null }),
    goals: lines(goals), constraints: lines(constraints),
    budgetMinimumCents: cents(budgetMinimum),
    budgetMaximumCents: cents(budgetMaximum),
    currency: budgetMinimum.trim() || budgetMaximum.trim() ? "USD" : null,
  }), [budgetMaximum, budgetMinimum, constraints, draft?.brief, goals]);

  function hydrate(next: EventCreationDraft) {
    setDraft(next); setName(next.proposedName ?? ""); setLocation(next.locationName ?? ""); setStartsOn(next.startsOn ?? ""); setEndsOn(next.endsOn ?? "");
    setGoals(joined(next.brief.goals)); setConstraints(joined(next.brief.constraints)); setPeople(next.people);
    setBudgetMinimum(dollars(next.brief.budgetMinimumCents)); setBudgetMaximum(dollars(next.brief.budgetMaximumCents));
  }

  async function createDraft(body: object, analytics: "description" | "recent", startNow = false) {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const { draft: next } = await requestJson<{ draft: EventCreationDraft }>("/api/v1/event-creation-drafts", { method: "POST", body: JSON.stringify(body) });
      hydrate(next); setStage("setup"); history.replaceState(null, "", `/new/?draft=${next.id}`);
      trackProductEvent(analytics === "description" ? "event_description_submitted" : "recent_event_selected", { properties: { source: next.sourceKind, participantCount: next.people.length, interpretationSupported: next.supported } });
      if (!next.supported) trackProductEvent("event_creation_blocked_unsupported_type", { properties: { source: next.sourceKind } });
      // Only a new, supported, empty trip can skip setup. Reused people and their invitations always get reviewed.
      if (startNow && next.sourceKind === "description" && next.supported && next.people.length === 0) {
        setStage("review"); // A failed commit leaves this same saved draft available to retry, never another creation request.
        await finishCreation(next, false);
      }
    } catch (cause) { setError(personFacingError(cause, "Trip setup is unavailable.")); } finally { setBusy(false); }
  }

  function createFromDescription(event: FormEvent) {
    event.preventDefault();
    if (!signedIn) { router.push(tripEntrySignInPath(entry.entryContext, entry.requestedDraftId)); return; }
    // A name is enough: the trip's questions take over from setup.
    void createDraft({ sourceKind: "description", title, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, templateKey, entryContext: entry.entryContext }, "description", true);
  }

  async function saveSetup(forceTravel = false) {
    if (!draft || busy) return;
    setBusy(true); setError(null);
    try {
      const { draft: next } = await requestJson<{ draft: EventCreationDraft }>(`/api/v1/event-creation-drafts/${draft.id}`, { method: "PATCH", body: JSON.stringify({ expectedVersion: draft.version, proposedName: name, locationName: location.trim() || null, startsOn: startsOn || null, endsOn: endsOn || null, brief, forceTravel }) });
      hydrate(next); setStage(next.sourceKind === "description" ? "review" : "people");
      const correctedFieldCount = [
        name !== draft.proposedName,
        (location.trim() || null) !== draft.locationName,
        (startsOn || null) !== draft.startsOn,
        (endsOn || null) !== draft.endsOn,
        joined(lines(goals)) !== joined(draft.brief.goals),
        joined(lines(constraints)) !== joined(draft.brief.constraints),
        cents(budgetMinimum) !== draft.brief.budgetMinimumCents,
        cents(budgetMaximum) !== draft.brief.budgetMaximumCents,
      ].filter(Boolean).length;
      trackProductEvent("event_setup_reviewed", { properties: { source: next.sourceKind, hasDates: Boolean(next.startsOn), hasLocation: Boolean(next.locationName), correctedFieldCount, interpretationStatus: draft.interpretationStatus } });
    } catch (cause) { setError(personFacingError(cause, "Check the trip details.")); } finally { setBusy(false); }
  }

  function addPerson() {
    setPeople((current) => [...current, { id: crypto.randomUUID(), personId: null, displayName: "", email: null, message: null, source: "description", included: true, needsContact: true }]);
    trackProductEvent("event_person_added");
  }
  function updatePerson(id: string, update: { displayName?: string; email?: string | null; message?: string | null }) { setPeople((current) => current.map((person) => person.id === id ? { ...person, ...update } : person)); }
  function removePerson(id: string) { setPeople((current) => current.filter((person) => person.id !== id)); trackProductEvent("event_person_removed"); }

  async function savePeople() {
    if (!draft || busy) return;
    if (people.some((person) => !person.displayName.trim())) { setError("Add a name for each person, or remove the empty row."); return; }
    setBusy(true); setError(null);
    try {
      const { draft: next } = await requestJson<{ draft: EventCreationDraft }>(`/api/v1/event-creation-drafts/${draft.id}/people`, { method: "PUT", body: JSON.stringify({ expectedVersion: draft.version, people: people.map((person) => ({ id: person.id, personId: person.personId, displayName: person.displayName, email: person.email?.trim() || null, message: person.message?.trim() || null, included: true })) }) });
      hydrate(next); setStage("review");
    } catch (cause) { setError(personFacingError(cause, "Check the people you added.")); } finally { setBusy(false); }
  }

  async function commit(sendInvitations: boolean) {
    if (!draft || busy) return;
    setBusy(true); setError(null);
    await finishCreation(draft, sendInvitations);
  }

  async function finishCreation(targetDraft: EventCreationDraft, sendInvitations: boolean) {
    let createdEventSlug = committedSlug;
    try {
      const { result } = await requestJson<{ result: { eventId: string; slug: string; unsentInvitationCount: number; peopleNeedingContact: string[] } }>(`/api/v1/event-creation-drafts/${targetDraft.id}/commit`, { method: "POST", body: JSON.stringify({ commandId: crypto.randomUUID(), expectedVersion: targetDraft.version }) });
      createdEventSlug = result.slug;
      setCommittedEventId(result.eventId);
      setCommittedSlug(result.slug);
      if (!committedSlug) {
        trackProductEvent("event_creation_committed", { properties: { source: targetDraft.sourceKind, participantCount: targetDraft.people.length, unsentInvitationCount: result.unsentInvitationCount, missingContactCount: result.peopleNeedingContact.length, sendInvitations } });
      }
      if (sendInvitations && result.unsentInvitationCount > 0) {
        const payload = await requestJson<{ result: unknown }>(`/api/v1/commons/${result.slug}/setup/send`, { method: "POST" });
        const deliveries = SendSetupInvitationsResultSchema.parse(payload.result).deliveries;
        const failed = deliveries.filter((delivery) => delivery.deliveryState === "failed");
        trackProductEvent("invitation_sent", { commonsSlug: result.slug, properties: { count: deliveries.length, sent: deliveries.length - failed.length, source: "event_creation" } });
        if (failed.length) {
          setError(`The trip was created, but ${failed.length === 1 ? "one invitation was" : `${failed.length} invitations were`} not sent. Try again, or open the trip and use People.`);
          setBusy(false);
          return;
        }
      }
      router.push(`${commonsPath(result.eventId)}?arrival=0`);
    } catch (cause) {
      const detail = errorKind(cause) === "technical" ? "" : personFacingError(cause, "");
      setError(detail
        ? createdEventSlug
          ? sendInvitations ? `The trip was created, but invitations were not sent. ${detail}` : `The trip was created. Open it below. ${detail}`
          : detail
        : createdEventSlug
          ? sendInvitations ? "The trip was created, but invitations were not sent. Try again, or open the trip and use People." : "The trip was created. Open it below."
          : "The trip couldn’t be created.");
      setBusy(false);
    }
  }

  if (!signedIn) return <section className="event-entry-card"><span className="view-kicker">New trip</span><h1>What are you planning?</h1><p>Sign in to name a trip or start from one you planned before.</p><a className="form-submit" href={tripEntrySignInPath(entry.entryContext, entry.requestedDraftId)}>Sign in to start</a></section>;

  if (entry.draftLoadFailed && !draft) return <section className="event-entry-card" role="alert"><h1>We couldn’t open your saved trip.</h1><p>It may still be saved. Nothing was replaced.</p><div className="setup-actions"><Link className="button-secondary" href="/trips">Your trips</Link><button type="button" onClick={() => window.location.reload()}>Try again</button></div></section>;

  if (stage === "entry") return <section className="event-entry-card"><span className="view-kicker">New trip</span><h1>What are you planning?</h1><p>Start with a name. You don’t need dates or a place yet.</p>
    <form className="event-title-form" onSubmit={createFromDescription}><label className="field"><span>Trip name</span><input required maxLength={100} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Napa or Sonoma girls trip" /></label>{PLAN_TEMPLATES.length > 1 ? <fieldset className="plan-kind"><legend>What kind of plan?</legend>{PLAN_TEMPLATES.map((template) => <label className="plan-kind__option" key={template.key}><input type="radio" name="plan-kind" value={template.key} checked={templateKey === template.key} onChange={() => setTemplateKey(template.key)} /><span className="plan-kind__label">{template.label}</span><small>{template.description}</small></label>)}</fieldset> : null}<button className="form-submit" disabled={busy || !title.trim()}>{busy ? "Starting…" : "Continue"}</button><p className="field-hint">Only you can see it until you invite people.</p></form>
    {initialRecentEvents.length ? <div className="recent-event-picker"><div className="event-section-heading"><h2>Or plan it again</h2><span>{initialRecentEvents.length} recent</span></div><div className="recent-event-list">{initialRecentEvents.map((event) => <button type="button" key={event.id} onClick={() => void createDraft({ sourceKind: "prior_event", sourceEventId: event.id, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }, "recent")} disabled={busy}><span><strong>{event.name}</strong><small>{event.locationName ?? "Place to be decided"} · {event.people.length} {event.people.length === 1 ? "person" : "people"}</small></span><em>Use this trip →</em></button>)}</div></div> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}</section>;

  if (!draft) return null;
  const readyInvitationCount = people.filter((person) => !person.needsContact).length;
  return <div data-analytics-exclude={/^QA(?:\s|[—:-])/i.test(draft.proposedName ?? "") ? "true" : undefined} className="event-draft-flow"><Progress stage={stage} />
    {stage === "setup" ? <section className="event-draft-card setup-panel"><span className="view-kicker">Your starting point</span><h1>Does this look right?</h1>
      {!draft.supported ? <div className="event-support-note"><strong>This may not be a trip.</strong><p>Commons only plans trips so far. If this is one, continue and set it up yourself.</p></div> : null}
      <div className="event-fields-grid"><label className="field field--wide"><span>Trip name</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} /></label><label className="field field--wide"><span>Place <small>Optional</small></span><input value={location} onChange={(event) => setLocation(event.target.value)} maxLength={120} placeholder="Add a city, region, or venue" /></label><label className="field"><span>Starts <small>Optional</small></span><input type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} /></label><label className="field"><span>Ends <small>Optional</small></span><input type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} /></label></div><details className="event-optional-details"><summary>Budget and preferences <small>Optional</small></summary><div className="event-fields-grid"><label className="field"><span>Budget from <small>Optional</small></span><input inputMode="decimal" value={budgetMinimum} onChange={(event) => setBudgetMinimum(event.target.value)} placeholder="$0" /></label><label className="field"><span>Budget to <small>Optional</small></span><input inputMode="decimal" value={budgetMaximum} onChange={(event) => setBudgetMaximum(event.target.value)} placeholder="$0" /></label><label className="field field--wide"><span>What would make this trip great? <small>Optional</small></span><textarea value={goals} onChange={(event) => setGoals(event.target.value)} placeholder={"A relaxed pace\nA house near the water\nTime together"} /></label><label className="field field--wide"><span>Anything we should plan around? <small>Optional</small></span><textarea value={constraints} onChange={(event) => setConstraints(event.target.value)} placeholder={"Dietary or accessibility needs\nNo long driving days\nA firm budget or schedule"} /></label></div></details>
      <div className="setup-actions"><button className="secondary" type="button" onClick={() => setStage("entry")}>Back</button><button type="button" disabled={busy || !name.trim()} onClick={() => void saveSetup(!draft.supported)}>{busy ? "Saving…" : draft.sourceKind === "description" ? "Review trip" : draft.supported ? "Continue to people" : "This is a trip, continue"}</button></div></section> : null}
    {stage === "people" ? <section className="event-draft-card setup-panel"><span className="view-kicker">People</span><h1>Who’s part of it?</h1><p className="setup-lede">Add or remove people before you create the trip. No invitations are sent here.</p><div className="event-people-list">{people.map((person) => <div className="event-person-row" key={person.id}><label className="field"><span>Name</span><input value={person.displayName} onChange={(event) => updatePerson(person.id, { displayName: event.target.value })} /></label>{person.needsContact || !person.personId ? <label className="field"><span>Email <small>Optional</small></span><input type="email" value={person.email ?? ""} onChange={(event) => updatePerson(person.id, { email: event.target.value || null })} placeholder="name@example.com" /></label> : <div className="event-known-person"><span>Contact</span><strong>Ready to invite</strong><small>Already connected through a past trip</small></div>}<button type="button" className="event-remove-person" onClick={() => removePerson(person.id)} aria-label={`Remove ${person.displayName || "person"}`}>Remove</button><label className="field event-person-message"><span>Invitation message <small>Optional</small></span><textarea value={person.message ?? ""} onChange={(event) => updatePerson(person.id, { message: event.target.value || null })} maxLength={500} placeholder="Add a quick personal note" /></label></div>)}</div><button type="button" className="add-participant" onClick={addPerson}>{people.length ? "＋ Add another person" : "＋ Add a person"}</button><div className="setup-actions"><button className="secondary" type="button" onClick={() => setStage("setup")}>Back</button><button type="button" disabled={busy} onClick={() => void savePeople()}>{busy ? "Saving…" : "Review trip"}</button></div></section> : null}
    {stage === "review" ? <section className="event-draft-card setup-panel"><span className="view-kicker">Review</span><h1>Ready to create?</h1><p className="setup-lede">Review the trip and choose whether to invite people now.</p><div className="event-review-block"><h2>{draft.proposedName}</h2><p>{draft.locationName ?? "Place to be decided"} · {dateLabel(draft.startsOn, draft.endsOn)}</p>{draft.brief.budgetMinimumCents !== null || draft.brief.budgetMaximumCents !== null ? <p>Budget {new Intl.NumberFormat(undefined, { style: "currency", currency: draft.brief.currency ?? "USD", maximumFractionDigits: 0 }).format((draft.brief.budgetMinimumCents ?? draft.brief.budgetMaximumCents ?? 0) / 100)}{draft.brief.budgetMinimumCents !== null && draft.brief.budgetMaximumCents !== null ? `–${new Intl.NumberFormat(undefined, { style: "currency", currency: draft.brief.currency ?? "USD", maximumFractionDigits: 0 }).format(draft.brief.budgetMaximumCents / 100)}` : ""}</p> : null}</div>{draft.brief.goals.length || draft.brief.constraints.length ? <div className="event-review-columns">{draft.brief.goals.length ? <div><strong>What would make it great</strong><ul>{draft.brief.goals.map((goal) => <li key={goal}>{goal}</li>)}</ul></div> : null}{draft.brief.constraints.length ? <div><strong>Things to plan around</strong><ul>{draft.brief.constraints.map((constraint) => <li key={constraint}>{constraint}</li>)}</ul></div> : null}</div> : null}<div className="event-review-people"><div className="event-section-heading"><h2>People</h2><span>{people.length}</span></div>{people.length ? people.map((person) => <div key={person.id}><strong>{person.displayName}</strong><small>{person.needsContact ? "Contact details can be added later" : person.message ? "Invitation ready · Includes a message" : "Invitation ready"}</small></div>) : <p>No one added yet.</p>}</div><div className="event-review-boundary"><strong>{readyInvitationCount ? `${readyInvitationCount} ${readyInvitationCount === 1 ? "invitation" : "invitations"} ready to send.` : "Nothing has been shared."}</strong><p>{readyInvitationCount ? "Creating and sending will email each person a private link. No invitations have been sent yet." : "The trip will stay private until you add and invite people."}</p></div>{committedEventId ? <div className="setup-actions"><a className="secondary" href={commonsPath(committedEventId)}>Open trip</a><button type="button" disabled={busy} onClick={() => void commit(true)}>{busy ? "Sending…" : "Try sending again"}</button></div> : <><div className="setup-actions"><button className="secondary" type="button" onClick={() => setStage("people")}>Back</button><button type="button" disabled={busy} onClick={() => void commit(readyInvitationCount > 0)}>{busy ? readyInvitationCount ? "Creating and sending…" : "Creating…" : readyInvitationCount ? `Create and send ${readyInvitationCount === 1 ? "invitation" : `${readyInvitationCount} invitations`}` : "Create private trip"}</button></div>{readyInvitationCount ? <button className="setup-open-private" type="button" onClick={() => void commit(false)} disabled={busy}>Create without sending</button> : null}</>}</section> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}</div>;
}
