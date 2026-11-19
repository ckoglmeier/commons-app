"use client";

import { useEffect, useState } from "react";
import { LockIcon } from "./icons";
import { TRIP_FEE_LABEL, TRIP_UPGRADE_INVITE } from "@/lib/trip-activation/copy";

/*
 * What's held for "We're going" (docs/TRIP-STAGES-DIRECTION.md). Visible on purpose, so an organizer can see what comes next.
 * This is presentation, not a permission: nothing saved is hidden for good, and it opens the moment the trip is going.
 */

type Offer = { upgrade: boolean; paid: boolean };

/** The one way forward. Pay first where the trip has a fee; otherwise saying it is the whole step. */
export function GoingAction({ slug, offer, emphasized = true, intent = "going", inviteFlowAvailable = true, lead = TRIP_UPGRADE_INVITE.lead }: {
  slug: string; offer: Offer; emphasized?: boolean; intent?: "going" | "invite"; inviteFlowAvailable?: boolean; lead?: string;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const className = emphasized ? "cm-action cm-action--primary" : "cm-action";
  const flow = `/c/${encodeURIComponent(slug)}/first-invite`;
  const label = intent === "invite" ? offer.upgrade && !offer.paid ? "Unlock this trip to invite people" : "We’re going — invite people" : "We’re going";
  async function declare() {
    setBusy(true); setError("");
    const response = await fetch(`/api/v1/commons/${encodeURIComponent(slug)}/going`, { method: "POST" }).catch(() => null);
    if (response?.ok) { window.location.assign(`/c/${encodeURIComponent(slug)}?arrival=0`); return; }
    setBusy(false); setError("That didn’t save. Your trip is unchanged. Try again.");
  }
  return <div className="stage-going">
    <p className="stage-going__lead">{lead}</p>
    {offer.upgrade && !offer.paid
      ? <><a className={className} href={flow}>{intent === "invite" ? label : TRIP_UPGRADE_INVITE.action}</a><p className="stage-going__fee">{TRIP_FEE_LABEL}</p></>
      : offer.paid || (intent === "invite" && inviteFlowAvailable) ? <a className={className} href={flow}>{label}</a>
      : <button type="button" className={className} disabled={busy} onClick={() => void declare()}>{busy ? "Saving…" : label}</button>}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
  </div>;
}

/** Only an organizer gets an answer here, so a traveler simply sees no action. */
function useOffer(slug: string) {
  const [offer, setOffer] = useState<Offer | null>(null);
  useEffect(() => {
    let live = true;
    void fetch(`/api/v1/commons/${encodeURIComponent(slug)}/big-questions`, { cache: "no-store" })
      .then(response => response.ok ? response.json() as Promise<Offer> : null)
      .then(next => { if (live && next) setOffer({ upgrade: next.upgrade, paid: next.paid }); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [slug]);
  return offer;
}

export const STAGE_GATED = {
  money: { title: "Money", lead: "Track shared costs once you’re going.", features: ["Shared expenses and who paid", "Everyone’s balance, currency by currency", "A ledger you can export and close"] },
  photos: { title: "Photos", lead: "Share trip photos once you’re going.", features: ["Everyone’s photos", "Your cover and trip page", "Photos for the recap"] },
  map: { title: "Map", lead: "See your plans on a map once you’re going.", features: ["Your stays and activities", "How far things are from each other", "Directions you can hand off"] },
} as const;

export function StageLockedPage({ slug, kind }: { slug: string; kind: keyof typeof STAGE_GATED }) {
  const content = STAGE_GATED[kind], offer = useOffer(slug);
  return <div className="product-view stage-locked">
    <section className="cm-document-paper stage-locked__paper" aria-labelledby="stage-locked-title">
      <h2 id="stage-locked-title"><LockIcon /> {content.title}</h2>
      <p>{content.lead}</p>
      <ul>{content.features.map(feature => <li key={feature}>{feature}</li>)}</ul>
      {offer ? <GoingAction slug={slug} offer={offer} /> : <p className="trip-letter__quiet">This opens once your organizer says the trip is going.</p>}
    </section>
  </div>;
}

/** Plan stays open for ideas. This says what's next without getting in the way of them. */
export function PlanStageBanner({ slug }: { slug: string }) {
  const offer = useOffer(slug);
  if (!offer) return null;
  return <section className="stage-plan-banner" aria-label="What opens next">
    <p>The map opens when you’re going.</p>
    <GoingAction slug={slug} offer={offer} emphasized={false} />
  </section>;
}

/** Budget estimates remain free; this opens the existing commitment flow. */
export function BudgetActivationAction({ slug }: { slug: string }) {
  const offer = useOffer(slug);
  if (!offer) return null;
  return <GoingAction slug={slug} offer={offer} lead="Ready to go? Track shared expenses, split costs and record repayments." />;
}
