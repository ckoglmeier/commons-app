"use client";

import { useState } from "react";
import { personFacingError } from "@/lib/person-facing-error";

export function ProfileOriginForm({ initialValue = "", compact = false }: { initialValue?: string | null; compact?: boolean }) {
  const [origin, setOrigin] = useState(initialValue ?? "");
  const [saved, setSaved] = useState(initialValue ?? "");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/v1/profile", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ usualOriginLabel: origin.trim() || null }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Profile not saved.");
      setSaved(payload.usualOriginLabel ?? "");
      setMessage("Saved.");
    } catch (error) {
      setMessage(personFacingError(error, "Profile not saved. Try again."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className={`profile-origin${compact ? " profile-origin--compact" : ""}`} onSubmit={save}>
      <span className="view-kicker">Travel profile · Optional</span>
      <h2>Where do you usually travel from?</h2>
      <p>Only you and Commons can see this. We’ll ask before using it for a trip.</p>
      <label className="field"><span>City or airport</span><input value={origin} onChange={(event) => setOrigin(event.target.value)} placeholder="Denver or DEN" maxLength={160} /></label>
      <div><button type="submit" disabled={pending || origin.trim() === saved}>{pending ? "Saving…" : "Save"}</button>{origin && !saved ? <button type="button" onClick={() => setOrigin("")}>Not now</button> : null}</div>
      {message ? <small role="status">{message}</small> : null}
    </form>
  );
}
