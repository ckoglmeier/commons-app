"use client";

import { useEffect, useState } from "react";
import { LockIcon } from "./icons";

/*
 * What's held for "We're going" (docs/TRIP-STAGES-DIRECTION.md). Visible on purpose, so an organizer can see what comes next.
 * This is presentation, not a permission: nothing saved is hidden for good, and it opens the moment the trip is going.
 */

const DEFAULT_LEAD = "Ready to go? Open Money, Photos and the map, and invite people to join.";

/** The one way forward: the organizer saying the trip is going. */
export function GoingAction({ slug, emphasized = true, intent = "going", lead = DEFAULT_LEAD }: {
  slug: string; emphasized?: boolean; intent?: "going" | "invite"; lead?: string;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const className = emphasized ? "cm-action cm-action--primary" : "cm-action";
  const label = intent === "invite" ? "We’re going — invite people" : "We’re going";
  async function declare() {
    setBusy(true); setError("");
    const response = await fetch(`/api/v1/commons/${encodeURIComponent(slug)}/going`, { method: "POST" }).catch(() => null);
    if (response?.ok) { window.location.assign(`/c/${encodeURIComponent(slug)}?arrival=0`); return; }
    setBusy(false); setError("That didn’t save. Your trip is unchanged. Try again.");
  }
  return <div className="stage-going">
    <p className="stage-going__lead">{lead}</p>
    <button type="button" className={className} disabled={busy} onClick={() => void declare()}>{busy ? "Saving…" : label}</button>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
  </div>;
}

/** Only an organizer gets an answer here, so a traveler simply sees no action. */
function useIsOrganizer(slug: string) {
  const [organizer, setOrganizer] = useState(false);
  useEffect(() => {
    let live = true;
    void fetch(`/api/v1/commons/${encodeURIComponent(slug)}/big-questions`, { cache: "no-store" })
      .then(response => { if (live && response.ok) setOrganizer(true); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [slug]);
  return organizer;
}

export const STAGE_GATED = {
  money: { title: "Money", lead: "Track shared costs once you’re going.", features: ["Shared expenses and who paid", "Everyone’s balance, currency by currency", "A ledger you can export and close"] },
  photos: { title: "Photos", lead: "Share trip photos once you’re going.", features: ["Everyone’s photos", "Your cover and trip page", "Photos for the recap"] },
  map: { title: "Map", lead: "See your plans on a map once you’re going.", features: ["Your stays and activities", "How far things are from each other", "Directions you can hand off"] },
} as const;

export function StageLockedPage({ slug, kind }: { slug: string; kind: keyof typeof STAGE_GATED }) {
  const content = STAGE_GATED[kind], organizer = useIsOrganizer(slug);
  return <div className="product-view stage-locked">
    <section className="cm-document-paper stage-locked__paper" aria-labelledby="stage-locked-title">
      <h2 id="stage-locked-title"><LockIcon /> {content.title}</h2>
      <p>{content.lead}</p>
      <ul>{content.features.map(feature => <li key={feature}>{feature}</li>)}</ul>
      {organizer ? <GoingAction slug={slug} /> : <p className="trip-letter__quiet">This opens once your organizer says the trip is going.</p>}
    </section>
  </div>;
}

/** Plan stays open for ideas. This says what's next without getting in the way of them. */
export function PlanStageBanner({ slug }: { slug: string }) {
  const organizer = useIsOrganizer(slug);
  if (!organizer) return null;
  return <section className="stage-plan-banner" aria-label="What opens next">
    <p>The map opens when you’re going.</p>
    <GoingAction slug={slug} emphasized={false} />
  </section>;
}
