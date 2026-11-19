"use client";
import { clockTime } from "@/lib/clock-time";
import { useState } from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";
import { CommonsSnapshotSchema, type CommonsSnapshot, type TravelPlan } from "@commons/contracts";
import { CommonsMark } from "@commons/ui";
import { LogisticsAddMenu } from "./logistics-add-menu";
import { TravelPlansSheet } from "./commons-app";
import { commonsPath, commonsViewPath } from "@/lib/commons-route";

export function TravelWorkspace({ initialSnapshot, returnView = "logistics" }: { initialSnapshot: CommonsSnapshot; returnView?: "plan" | "logistics" }) {
  const router=useRouter();
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [editing, setEditing] = useState<{ kind: TravelPlan["kind"]; id: string | null } | null>(null);
  const [scope, setScope] = useState<"mine" | "group">("mine");
  const [notice, setNotice] = useState("");
  const plans = snapshot.state.travelPlans ?? [];
  const actorId = snapshot.currentActor.id;
  const participants = snapshot.participants.filter(person => person.membershipStatus === "active" || person.membershipStatus === "invited");
  const shown = plans.filter(plan => scope === "mine" ? plan.personId === actorId || plan.personIds?.includes(actorId) : plan.visibility !== "private");
  const existing = plans.find(plan => plan.id === editing?.id);
  async function command(method: string, input: unknown) {
    const response = await fetch(`/api/v1/commons/${snapshot.commons.slug}/travel-plans`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify({ commandId: crypto.randomUUID(), ...(input as object) }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Travel not saved. Your review is still here.");
    const saved = CommonsSnapshotSchema.parse(result.snapshot);
    setSnapshot(saved);
    setNotice("Travel updated.");
    return saved;
  }
  return <main className="travel-workspace" id="main-content">
    <header className="travel-workspace-nav"><Link href={commonsViewPath(snapshot.commons.id, returnView)}><CommonsMark /> Back to {returnView === "plan" ? "Plan" : "Logistics"}</Link><Link href="/trips/">Your trips</Link></header>
    <div className="travel-workspace-heading"><div><span className="view-kicker">{snapshot.commons.name}</span><h1>Travel</h1><p>Flights, transport, and rental cars.</p></div><div><LogisticsAddMenu canAddStay={snapshot.currentActor.role === "organizer"} choose={kind => { if (kind === "thing" || kind === "stay") { router.push(`${commonsViewPath(snapshot.commons.id, kind === "thing" ? "plan" : "logistics")}&add=${kind}`); } else setEditing({ kind: kind === "flight" ? "arrival" : "transport", id: kind === "flight" ? null : "" }); }} /></div></div>
    <div className="travel-kind-toggle" aria-label="Travel visibility"><button type="button" aria-pressed={scope === "mine"} className={scope === "mine" ? "active" : ""} onClick={() => setScope("mine")}>Your travel</button><button type="button" aria-pressed={scope === "group"} className={scope === "group" ? "active" : ""} onClick={() => setScope("group")}>Shared with group</button></div>
    <p className="expense-mode-help">{scope === "mine" ? "Bookings you added or are included in. Add costs in Money. Confirmation codes stay private." : "Only shared plans appear here. No shared plan does not mean someone has not booked."}</p>
    <p role="status">{notice}</p>
    <div className="travel-workspace-layout"><div>{(["arrival", "departure", "car_rental", "transport"] as const).map(kind => {
      const records = shown.filter(plan => plan.kind === kind).sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? ""));
      return <section className="travel-workspace-group" key={kind} aria-labelledby={`travel-${kind}`}><div className="section-heading"><h2 id={`travel-${kind}`}>{kind === "arrival" ? "Getting there" : kind === "departure" ? "Heading home" : kind === "transport" ? "Transport" : "Rental cars"}</h2><span>{records.length} {records.length === 1 ? "plan" : "plans"}</span></div>
        {!records.length ? <p className="expense-mode-help">{scope === "group" ? "No shared plans." : "No plans here yet."}</p> : records.map(plan => <article className="travel-workspace-record" key={plan.id}>
          <div className="travel-record-heading"><div><strong>{plan.provider ? `${plan.provider} · ${plan.route}` : plan.route}</strong><span>{plan.date} · {clockTime(plan.time)}{plan.returnDate ? ` — ${plan.returnDate}${plan.returnTime ? ` · ${clockTime(plan.returnTime)}` : ""}` : ""}</span><span>{plan.personName}</span></div>{plan.personId === actorId ? <button type="button" className="travel-add-another" onClick={() => setEditing({ kind, id: plan.id })}>Edit</button> : null}</div>
          <p className="expense-mode-help">{plan.visibility === "private" ? "Private · owner and included travelers" : plan.visibility === "all" ? "Shared including cost" : "Basic details shared"} · {plan.status === "considering" ? "Considering" : plan.status === "booked" ? "Booked" : "Confirmed"}</p>
          <details className="travel-record-details"><summary>View details</summary>
            {plan.connections?.map((flight, index) => <div className="travel-connection-record" key={index}><strong>{flight.flightNumber || `Flight ${index + 1}`} · {flight.origin || "From not added"} → {flight.destination || "To not added"}</strong><span>Departs {flight.departureDate || "Date not added"} · {clockTime(flight.departureTime)} {flight.departureTimezone ?? ""}</span><span>Arrives {flight.arrivalDate || "Date not added"} · {clockTime(flight.arrivalTime)} {flight.arrivalTimezone ?? ""}</span></div>)}
            {plan.confirmationCode ? <p>Confirmation: <strong>{plan.confirmationCode}</strong></p> : null}
            {plan.note ? <p>{plan.note}</p> : null}
            {(plan.kind === "car_rental" || plan.kind === "transport") && plan.totalCents ? <p>Booking total: {new Intl.NumberFormat("en-US", { style: "currency", currency: plan.currency ?? "USD" }).format(plan.totalCents / 100)}</p> : null}
            {plan.confirmationDocumentUrl ? <a className="confirmation-document-link" href={plan.confirmationDocumentUrl} target="_blank" rel="noreferrer">Open original confirmation</a> : null}
            <p className="expense-mode-help">{plan.sourceLabel}</p>
          </details>
          {plan.personId === actorId ? <div className="travel-record-actions"><button type="button" className="travel-add-another" onClick={() => setEditing({ kind, id: plan.id })}>Edit or remove</button>{(plan.kind === "car_rental" || plan.kind === "transport") && plan.totalCents && !snapshot.state.expenses.some(expense => expense.travelPlanId === plan.id) ? <Link href={`${commonsPath(snapshot.commons.id)}?travelExpense=${plan.id}`}>Record as expense</Link> : null}</div> : null}
        </article>)}
      </section>;
    })}</div><aside className="travel-workspace-coverage"><h2>Shared travel coverage</h2><p className="expense-mode-help">Private bookings are not counted here.</p>{participants.map(person => <div key={person.id}><strong>{person.displayName}</strong><span>{(["arrival", "departure"] as const).map(kind => `${kind === "arrival" ? "There" : "Home"}: ${plans.some(plan => plan.kind === kind && plan.visibility !== "private" && (plan.personIds ?? [plan.personId]).includes(person.id)) ? "shared" : "not shared"}`).join(" · ")}</span></div>)}</aside></div>
    {editing ? <TravelPlansSheet key={`${editing.kind}:${editing.id ?? "new"}`} commonsSlug={snapshot.commons.slug} kind={editing.kind} defaultDate={snapshot.commons.startsOn ?? ""} returnDefaultDate={snapshot.commons.endsOn ?? ""} plans={plans.filter(plan => editing.kind === "car_rental" || editing.kind === "transport" ? plan.kind === editing.kind : plan.kind === "arrival" || plan.kind === "departure")} allPlans={plans} participants={participants} currentActorId={actorId} currentActorName={snapshot.currentActor.displayName} close={() => setEditing(null)} save={async input => {
      await command("POST", { ...input, companionPersonId: input.companionPersonId || null, confirmationCode: input.confirmationCode || null });
      setEditing(null);
    }} saveBooking={async input => (await command("PUT", { ...input, confirmationCode: input.confirmationCode || null })).state.travelPlans} updateSharing={async (travelPlanId, visibility, expectedVersion) => (await command("PATCH", { travelPlanId, visibility, expectedVersion })).state.travelPlans} remove={async travelPlanId => { await command("DELETE", { travelPlanId }); setEditing(null); }} confirmationUploadEnabled selectedRentalPlanId={editing.id ?? existing?.id ?? null} /> : null}
  </main>;
}
