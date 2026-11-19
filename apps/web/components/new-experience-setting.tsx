"use client";

import { useState } from "react";

/** One trip's "New experience" setting. It changes how the trip looks for everyone on it, never what's saved. */
export function NewExperienceSetting({ slug, enabled }: { slug: string; enabled: boolean }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function change(next: boolean) {
    setBusy(true); setError("");
    const response = await fetch(`/api/v1/commons/${encodeURIComponent(slug)}/experience`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: next }) }).catch(() => null);
    if (response?.ok) { window.location.assign(`/c/${encodeURIComponent(slug)}?arrival=0`); return; }
    setBusy(false); setError("That didn’t save. Your trip is unchanged. Try again.");
  }
  return <section className="new-experience-setting" aria-labelledby="new-experience-title">
    <label className="new-experience-setting__row"><input type="checkbox" checked={enabled} disabled={busy} onChange={event => void change(event.target.checked)} /><span id="new-experience-title">New experience</span></label>
    <p>A new Trip page, with Photos in the menu. Everyone on this trip sees it. Your plans, costs and people don’t change, and you can switch back.</p>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
  </section>;
}
