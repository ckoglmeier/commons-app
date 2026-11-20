"use client";
import { useRef, useState } from "react";
import type { CommonsSummary, ItineraryItem, LinkPreview, Stay } from "@commons/contracts";
import { isRentalListing } from "../lib/trip-map";
import { CloseIcon } from "./icons";
import { ModalLayer } from "./modal-layer";
import { personFacingError } from "@/lib/person-facing-error";

export type QuickAddInput = { name: string; address: string; url: string | null; pin: LinkPreview["pin"] | null; startsOn: string; endsOn: string; commandId: string };
type Found = { note: string; pin: LinkPreview["pin"] | null; url: string | null };
const normal = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** The quickest way to capture an activity idea or a stay option: a name, a
 * link, or a PDF or image to read them from. Everything else can be added later. */
export function TripQuickAddSheet({ kind, commons, stays, itinerary, lookUp, readFile, save, addDetails, useFullForm, close }: {
  kind: "activity" | "stay"; commons: CommonsSummary; stays: Stay[]; itinerary: ItineraryItem[];
  lookUp: (url: string) => Promise<LinkPreview>;
  readFile: (file: File) => Promise<{ title: string | null; url: string | null; readable: boolean }>;
  save: (input: QuickAddInput) => Promise<string | null>;
  addDetails: (id: string) => void; useFullForm: () => void; close: () => void;
}) {
  const [name, setName] = useState(""), [link, setLink] = useState(""), [address, setAddress] = useState("");
  const [dates, setDates] = useState({ startsOn: commons.startsOn ?? "", endsOn: commons.endsOn ?? commons.startsOn ?? "" });
  const [found, setFound] = useState<Found | null>(null), [busy, setBusy] = useState<"look" | "file" | "save" | null>(null);
  const [error, setError] = useState(""), [saved, setSaved] = useState<{ id: string; name: string } | null>(null);
  const commandId = useRef(crypto.randomUUID()), lookedUp = useRef(""), fileInput = useRef<HTMLInputElement>(null);
  const noun = kind === "activity" ? "idea" : "option";
  const existing = (() => {
    const key = normal(name), url = found?.url ?? (link.trim() || null);
    return kind === "activity"
      ? itinerary.find(item => item.status !== "cancelled" && ((url && item.sourceUrl === url) || (key && normal(item.title) === key)))?.title
      : stays.find(stay => (url && stay.bookingUrl === url) || (key && normal(stay.name) === key))?.name;
  })();

  async function lookUpLink(value = link) {
    const url = value.trim();
    if (!/^https?:\/\//i.test(url) || lookedUp.current === url) return;
    lookedUp.current = url;
    if (kind === "stay" && isRentalListing(url)) {
      setFound({ note: "Rental listings hide the exact address. Add the area, and place an approximate pin on the map later.", pin: null, url });
      return;
    }
    setBusy("look"); setError("");
    try {
      const preview = await lookUp(url);
      setName(current => current.trim() ? current : preview.title);
      setAddress(current => current.trim() ? current : preview.location ?? "");
      setFound({ url: preview.url, pin: preview.pin ?? null, note: preview.pin ? `Found on the map from ${preview.pin.source === "map_link" ? "the maps link" : "its web page"}.`
        : preview.detailStatus === "link_only" ? "That site didn’t share details. Check the name; you can place it on the map later." : "Not on the map yet. You can place it later." });
    } catch (lookupError) {
      lookedUp.current = "";
      setFound(null);
      setError(`${personFacingError(lookupError, "That link couldn’t be read.")} You can still add it by name.`);
    } finally { setBusy(null); }
  }

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    setBusy("file"); setError("");
    try {
      const hints = await readFile(file);
      if (hints.title) setName(current => current.trim() ? current : hints.title!);
      if (hints.url && !link.trim()) { setLink(hints.url); await lookUpLink(hints.url); }
      if (!hints.readable) setError(hints.title ? "Commons used the file name. Check it, and add a link if you have one." : "Commons couldn’t read text from that file. Add the name, and a link if you have one.");
    } catch (fileError) {
      setError(personFacingError(fileError, "That file couldn’t be read. Add the name instead."));
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function submit() {
    if (!name.trim()) return setError(`Add a name for this ${noun}.`);
    if (existing) return setError(`Already on this trip as ${existing}.`);
    if (kind === "stay" && (!dates.startsOn || !dates.endsOn || dates.endsOn < dates.startsOn)) return setError("Choose the nights for this option.");
    setBusy("save"); setError("");
    try {
      const url = found?.url ?? (/^https?:\/\//i.test(link.trim()) ? link.trim() : null);
      const id = await save({ name: name.trim(), address: address.trim(), url, pin: found?.pin ?? null, ...dates, commandId: commandId.current });
      if (id) setSaved({ id, name: name.trim() }); else close();
    } catch (saveError) {
      setError(personFacingError(saveError, "Not added. Try again."));
    } finally { setBusy(null); }
  }

  const title = kind === "activity" ? "Add an activity idea" : "Add a stay option";
  const empty = !name.trim() && !link.trim() && !address.trim();
  return <ModalLayer close={close}>
    <section className="sheet trip-quick-add" role="dialog" aria-modal="true" aria-labelledby="trip-quick-add-title">
      <div className="sheet-handle" />
      <header className="sheet-header"><h2 id="trip-quick-add-title">{saved ? "Added" : title}</h2><button type="button" onClick={close} aria-label={`Close ${title.toLowerCase()}`}><CloseIcon /></button></header>
      {saved ? <>
        <p role="status">{saved.name} is on the trip as {kind === "activity" ? "an idea with no day set" : "an option you’re considering"}.</p>
        <div className="trip-map-actions">
          <button type="button" className="cm-action cm-action--primary" onClick={() => addDetails(saved.id)}>Add details</button>
          <button type="button" className="cm-action" onClick={close}>Done</button>
        </div>
      </> : <form onSubmit={event => { event.preventDefault(); void submit(); }}>
        <label className="field field--wide"><span>Link <small>Optional</small></span>
          <input type="url" inputMode="url" value={link} placeholder="Website, listing, or Google or Apple Maps link"
            onChange={event => { setLink(event.target.value); if (found && event.target.value.trim() !== found.url) setFound(null); }}
            onBlur={() => void lookUpLink()} onPaste={event => { const pasted = event.clipboardData.getData("text"); if (/^https?:\/\//i.test(pasted.trim())) setTimeout(() => void lookUpLink(pasted), 0); }} /></label>
        <label className="field field--wide"><span>Name</span>
          <input value={name} onChange={event => setName(event.target.value)} maxLength={kind === "activity" ? 120 : 160} placeholder={kind === "activity" ? "Gundlach Bundschu Winery" : "The Lodge at Sonoma"} /></label>
        <label className="field field--wide"><span>{kind === "activity" ? "Address" : "Address or area"} <small>Optional</small></span>
          <input value={address} onChange={event => setAddress(event.target.value)} maxLength={kind === "activity" ? 160 : 240} /></label>
        {kind === "stay" && !(commons.startsOn && commons.endsOn) ? <fieldset className="trip-map-add-dates"><legend>Nights</legend>
          <label className="field"><span>Check-in</span><input type="date" value={dates.startsOn} onChange={event => setDates(current => ({ ...current, startsOn: event.target.value }))} /></label>
          <label className="field"><span>Check-out</span><input type="date" value={dates.endsOn} onChange={event => setDates(current => ({ ...current, endsOn: event.target.value }))} /></label>
        </fieldset> : null}
        <div className="trip-quick-add-file">
          <input ref={fileInput} id="trip-quick-add-file" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" hidden onChange={event => void chooseFile(event.target.files?.[0])} />
          <button type="button" className="cm-action cm-action--quiet" disabled={Boolean(busy)} onClick={() => fileInput.current?.click()}>{busy === "file" ? "Reading…" : "Use a PDF or image"}</button>
          <span className="trip-map-note">Commons reads it to fill in the name and link. The file isn’t kept.</span>
        </div>
        <p className="trip-map-note" role="status">{busy === "look" ? "Looking up the link…" : existing ? `Already on this trip as ${existing}.` : found?.note ?? ""}</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="trip-map-actions">
          <button type="submit" className="cm-action cm-action--primary" disabled={Boolean(busy) || !name.trim() || Boolean(existing)}>{busy === "save" ? "Adding…" : kind === "activity" ? "Add idea" : "Add option"}</button>
          {empty ? <button type="button" className="cm-action cm-action--quiet" onClick={useFullForm}>{kind === "activity" ? "Schedule it now instead" : "Add a booked stay instead"}</button> : null}
        </div>
        <p className="trip-map-note">{kind === "activity" ? "Ideas have no day or time yet." : `Added for ${commons.startsOn && commons.endsOn ? "the trip’s dates" : "these nights"} and everyone on the trip.`}</p>
      </form>}
    </section>
  </ModalLayer>;
}
