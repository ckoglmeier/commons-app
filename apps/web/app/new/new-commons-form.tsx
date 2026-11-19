"use client";

import {
  CommonsSetupSchema,
  SendSetupInvitationsResultSchema,
  type CommonsSetup,
  type InvitationDelivery,
} from "@commons/contracts";
import { CommonsMark } from "@commons/ui";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { commonsPath, commonsSetupPath } from "@/lib/commons-route";
import { useEffect, useRef, useState } from "react";
import { CheckIcon, CloseIcon, ImageIcon, PlusIcon, UsersIcon } from "@/components/icons";
import { getSupabaseBrowserClient, uploadCommonsCover } from "@/lib/supabase/browser";
import { createCoverCardImage } from "@/lib/cover-image";
import { trackProductEvent } from "@/lib/product-analytics";

type SetupStep = "details" | "people" | "review";
type TravelerDraft = { displayName: string; email: string };

const steps: Array<{ id: SetupStep; number: number; label: string }> = [
  { id: "details", number: 0, label: "Setup" },
  { id: "people", number: 1, label: "Invite people" },
  { id: "review", number: 2, label: "Review and approve" },
];

function validStep(value?: string): SetupStep {
  if (value === "people" || value === "review") return value;
  if (value === "plans") return "review";
  return "details";
}

function SetupProgress({ current }: { current: SetupStep }) {
  const currentIndex = steps.findIndex((item) => item.id === current);
  return (
    <nav className="setup-progress" aria-label="Start trip progress">
      <ol>
        {steps.map((item, index) => (
          <li key={item.id} className={index < currentIndex ? "complete" : index === currentIndex ? "active" : ""} aria-current={index === currentIndex ? "step" : undefined}>
            <span>{index < currentIndex ? <CheckIcon /> : item.number}</span>
            <strong>{item.label}</strong>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function tripDates(startsOn: string | null, endsOn: string | null) {
  if (!startsOn || !endsOn) return "Dates to be decided";
  const start = new Date(`${startsOn}T12:00:00Z`);
  const end = new Date(`${endsOn}T12:00:00Z`);
  const sameMonth = start.getUTCMonth() === end.getUTCMonth() && start.getUTCFullYear() === end.getUTCFullYear();
  const startLabel = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: sameMonth ? undefined : "numeric",
    timeZone: "UTC",
  }).format(start);
  return sameMonth
    ? `${startLabel}–${end.getUTCDate()}, ${end.getUTCFullYear()}`
    : `${startLabel}–${new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(end)}`;
}

async function responseJson(response: Response, fallback: string) {
  const text = await response.text();
  let payload: Record<string, unknown> | null = null;
  try {
    payload = text ? JSON.parse(text) as Record<string, unknown> : null;
  } catch {
    payload = null;
  }
  if (!response.ok) throw new Error(typeof payload?.error === "string" ? payload.error : fallback);
  return payload ?? {};
}

export function NewCommonsForm({
  initialSetup,
  initialStep,
}: {
  /** The trip this setup continues. Creating a trip happens at /new. */
  initialSetup: CommonsSetup;
  initialStep?: string;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const coverObjectUrlRef = useRef<string | null>(null);
  const requestedStep = validStep(initialStep);
  const [step, setStep] = useState<SetupStep>(requestedStep === "details" ? "people" : requestedStep);
  const [setup, setSetup] = useState<CommonsSetup | null>(initialSetup);
  const [travelers, setTravelers] = useState<TravelerDraft[]>(initialSetup?.travelers.length ? initialSetup.travelers.map(({ displayName, email }) => ({ displayName, email })) : [{ displayName: "", email: "" }]);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(initialSetup?.commons.coverImageUrl ?? null);
  const [deliveries, setDeliveries] = useState<InvitationDelivery[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const completeTravelers = travelers.filter((traveler) => traveler.displayName.trim() && traveler.email.trim());
  const travelersToInvite = setup?.travelers.filter((traveler) => traveler.deliveryState !== "sent") ?? [];
  useEffect(() => {
    return () => {
      if (coverObjectUrlRef.current) URL.revokeObjectURL(coverObjectUrlRef.current);
    };
  }, []);

  function chooseCover(file: File | null) {
    if (coverObjectUrlRef.current) URL.revokeObjectURL(coverObjectUrlRef.current);
    coverObjectUrlRef.current = file ? URL.createObjectURL(file) : null;
    setCoverFile(file);
    setCoverPreview(coverObjectUrlRef.current ?? setup?.commons.coverImageUrl ?? null);
  }

  function move(next: SetupStep) {
    setError("");
    setStep(next);
    if (setup) router.replace(commonsSetupPath(setup.commons.id, next), { scroll: false });
    window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  function updateTraveler(index: number, patch: Partial<TravelerDraft>) {
    setTravelers((current) => current.map((traveler, position) => position === index ? { ...traveler, ...patch } : traveler));
  }

  async function uploadCover(slug: string) {
    if (!coverFile) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(coverFile.type)) throw new Error("Choose a JPG, PNG, or WebP cover photo.");
    if (coverFile.size > 50 * 1024 * 1024) throw new Error("The cover photo is over 50 MB. Choose a smaller copy.");
    const id = crypto.randomUUID();
    const card = await createCoverCardImage(coverFile);
    const paths = await uploadCommonsCover(slug, id, coverFile, card);
    let coverResponse: Response;
    try {
      coverResponse = await fetch(`/api/v1/commons/${slug}/cover`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commandId: crypto.randomUUID(), ...paths, mimeType: coverFile.type, sourceMomentId: null }),
      });
    } catch {
      throw new Error("Couldn’t confirm the cover update. Refresh the trip before trying again.");
    }
    if (!coverResponse.ok) {
      await getSupabaseBrowserClient().storage.from("commons-moments").remove([paths.originalStoragePath, paths.cardStoragePath]);
    }
    await responseJson(coverResponse, "Cover not added. Your traveler list is still saved.");
  }

  async function savePeople(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!setup) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const exitAfterSave = submitter?.value === "exit";
    setError("");
    const incomplete = travelers.some((traveler) => Boolean(traveler.displayName.trim()) !== Boolean(traveler.email.trim()));
    if (incomplete) {
      setError("Add both a name and email, or remove the unfinished row.");
      return;
    }
    setPending(true);
    try {
      const response = await fetch(`/api/v1/commons/${setup.commons.slug}/setup`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ travelers: completeTravelers }),
      });
      const payload = await responseJson(response, "Travelers not saved. Your entries are still here. Try again.");
      const savedSetup = CommonsSetupSchema.parse(payload.setup);
      if (coverFile) await uploadCover(savedSetup.commons.slug);
      setSetup({ ...savedSetup, commons: { ...savedSetup.commons, coverImageUrl: coverPreview } });
      if (exitAfterSave) router.push("/trips");
      else move("review");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Travelers not saved. Your entries are still here. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function sendInvitations() {
    if (!setup) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/commons/${setup.commons.slug}/setup/send`, { method: "POST" });
      const payload = await responseJson(response, "Invitations not sent. The trip is still private.");
      const nextDeliveries = SendSetupInvitationsResultSchema.parse(payload.result).deliveries;
      setDeliveries(nextDeliveries);
      trackProductEvent("invitation_sent", {
        commonsSlug: setup.commons.slug,
        properties: {
          count: nextDeliveries.length,
          sent: nextDeliveries.filter((delivery) => delivery.deliveryState === "sent").length,
        },
      });
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Invitations not sent. The trip is still private.");
    } finally {
      setPending(false);
    }
  }

  async function openWithoutInviting() {
    if (!setup) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/commons/${setup.commons.slug}/setup/complete`, { method: "POST" });
      await responseJson(response, "Setup not finished. Try again.");
      router.push(commonsPath(setup.commons.id));
    } catch (finishError) {
      setError(finishError instanceof Error ? finishError.message : "Setup not finished. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function copyFallback(delivery: InvitationDelivery) {
    if (!delivery.token) return;
    await navigator.clipboard.writeText(`${window.location.origin}/join/${delivery.token}`);
    trackProductEvent("invitation_link_copied", { commonsSlug: setup?.commons.slug, properties: { source: "setup" } });
    setCopied(delivery.invitationId);
    window.setTimeout(() => setCopied(null), 1800);
  }

  if (!setup) return null;

  if (deliveries) {
    const sentCount = deliveries.filter((delivery) => delivery.deliveryState === "sent").length;
    return (
      <section className="creation-result setup-panel" aria-live="polite">
        <span className="creation-result__mark"><CheckIcon /></span>
        <span className="view-kicker">Invitations</span>
        <h1>{sentCount === deliveries.length ? `${sentCount} sent.` : `${sentCount} of ${deliveries.length} sent.`}</h1>
        <p>Each invitation says {setup.organizerName} invited them to {setup.commons.name}.</p>
        <div className="invite-link-list">
          {deliveries.map((delivery) => <div key={delivery.invitationId}><span><strong>{delivery.recipientName}</strong><small>{delivery.deliveryState === "sent" ? `Sent to ${delivery.recipientEmail}` : `Email not sent · ${delivery.recipientEmail}`}</small></span>{delivery.token ? <button type="button" onClick={() => void copyFallback(delivery)}>{copied === delivery.invitationId ? "Copied" : "Copy link"}</button> : <span className="invite-sent-status"><CheckIcon /> Sent</span>}</div>)}
        </div>
        <div className="creation-actions"><Link href={commonsPath(setup.commons.id)}>Open trip</Link><Link href="/trips">All trips</Link></div>
      </section>
    );
  }

  return (
    <section className="setup-panel-wrap">
      <SetupProgress current={step} />

      {step === "people" ? (
        <form className="new-commons-form setup-panel" onSubmit={savePeople}>
          <span className="view-kicker">Invite people</span>
          <h2>Who’s going?</h2>
          <p className="setup-lede">Add the people you want to invite. You’ll review the list before anything is sent.</p>
          <div className="setup-cover-picker">
            <button type="button" className="setup-cover-preview" onClick={() => fileInputRef.current?.click()}>{coverPreview ? <Image src={coverPreview} alt={`${setup.commons.name} cover preview`} fill sizes="(max-width: 767px) 100vw, 30rem" unoptimized /> : <span><ImageIcon /><strong>Add a cover photo</strong></span>}{coverPreview ? <em>Change cover</em> : null}</button>
            <input ref={fileInputRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => chooseCover(event.target.files?.[0] ?? null)} />
          </div>
          <div className="setup-travelers">
            {travelers.map((traveler, index) => <div className="setup-traveler-row" key={index}><span className="setup-traveler-icon"><UsersIcon /></span><label className="field"><span>Name</span><input value={traveler.displayName} onChange={(event) => updateTraveler(index, { displayName: event.target.value })} placeholder="Traveler name" /></label><label className="field"><span>Email</span><input value={traveler.email} onChange={(event) => updateTraveler(index, { email: event.target.value })} placeholder="name@example.com" type="email" /></label><button type="button" aria-label={`Remove traveler ${index + 1}`} onClick={() => setTravelers((current) => current.filter((_, position) => position !== index))}><CloseIcon /></button></div>)}
            <button className="add-participant" type="button" disabled={travelers.length >= 24} onClick={() => setTravelers((current) => [...current, { displayName: "", email: "" }])}><PlusIcon /> Add another person</button>
          </div>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className="setup-actions"><button type="submit" className="secondary" name="intent" value="exit" disabled={pending}>{pending ? "Saving…" : "Save and exit"}</button><button type="submit" name="intent" value="review" disabled={pending}>{pending ? "Saving…" : "Review invitations"}</button></div>
        </form>
      ) : null}

      {step === "review" ? (
        <section className="new-commons-form setup-panel">
          <span className="view-kicker">Review and approve</span>
          <h2>{setup.travelers.length ? "Ready to invite everyone?" : "Ready to open the trip?"}</h2>
          <p className="setup-lede">Check the trip and invitation list before you finish.</p>
          <div className="setup-trip-preview"><div className="setup-trip-preview__image">{coverPreview ? <Image src={coverPreview} alt="" fill sizes="8rem" unoptimized /> : <CommonsMark />}</div><div><strong>{setup.commons.name}</strong><span>{[tripDates(setup.commons.startsOn, setup.commons.endsOn), setup.commons.locationName].filter(Boolean).join(" · ")}</span></div></div>
          <div className="setup-review-section"><header><h3>Invitations</h3><span>{setup.travelers.length}</span></header>{setup.travelers.length ? setup.travelers.map((traveler) => <div className="setup-review-row" key={traveler.invitationId}><span><strong>{traveler.displayName}</strong><small>{traveler.email}</small></span><em>{traveler.deliveryState === "sent" ? "Email sent" : traveler.deliveryState === "failed" ? "Ready to retry" : traveler.deliveryState === "queued" ? "Sending" : "Ready"}</em></div>) : <p>No one else added.</p>}</div>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className="setup-actions">
            <button type="button" className="secondary" onClick={() => move("people")}>Edit people</button>
            {travelersToInvite.length ? <button type="button" onClick={() => void sendInvitations()} disabled={pending}>{pending ? "Sending…" : `Send ${travelersToInvite.length} ${travelersToInvite.length === 1 ? "invitation" : "invitations"}`}</button> : <button type="button" onClick={() => void openWithoutInviting()} disabled={pending}>{pending ? "Opening…" : "Open trip"}</button>}
          </div>
          {travelersToInvite.length ? <button className="setup-open-private" type="button" onClick={() => void openWithoutInviting()} disabled={pending}>Open trip without inviting</button> : null}
          {travelersToInvite.length ? <p className="form-trust-line">Each invitation says {setup.organizerName} invited them to {setup.commons.name}.</p> : null}
        </section>
      ) : null}
    </section>
  );
}
