"use client";
import { useEffect, useRef, useState } from "react";
import { GroupInvitationSchema, type GroupInvitation } from "@commons/contracts";
import { groupInvitationPath } from "@/lib/group-invitation";
import { stableCommand } from "@/lib/stable-command";

export function GroupInvitationPanel({ slug }: { slug: string }) {
  const [enabled, setEnabled] = useState(false), [link, setLink] = useState<GroupInvitation | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [fallbackURL, setFallbackURL] = useState("");
  const [loadedSlug, setLoadedSlug] = useState<string | null>(null);
  const pending = useRef(false), command = useRef<{ key: string; id: string } | null>(null);
  const endpoint = `/api/v1/commons/${encodeURIComponent(slug)}/group-invitation`;
  useEffect(() => {
    const abort = new AbortController();
    void fetch(endpoint, { cache: "no-store", signal: abort.signal }).then(async response => {
      const data = await response.json();
      if ([401, 403, 404].includes(response.status)) { if (!abort.signal.aborted) { setEnabled(false); setLoadedSlug(slug); } return; }
      if (!response.ok) throw new Error("The invite link couldn’t load. Reopen People to try again.");
      if (abort.signal.aborted) return;
      setEnabled(data.enabled === true); setLink(data.invitation ? GroupInvitationSchema.parse(data.invitation) : null); setLoadedSlug(slug);
    }).catch(cause => { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "Invite link unavailable."); });
    return () => abort.abort();
  }, [endpoint, slug]);

  async function copy() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(""); setNotice("");
    try {
      let saved = link;
      // Clicking the invite link approves the adjacent traveler-only scope. Never
      // create on load or replace an active link just because it is copied.
      if (!saved || saved.state !== "active") {
        const input = { action: saved ? "replace" : "create", expectedVersion: saved?.version ?? 0, scopeAccepted: true, expiresInDays: 14 };
        command.current = stableCommand(command.current, input);
        const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...input, commandId: command.current.id }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "The invite link couldn’t be confirmed. Try again.");
        saved = GroupInvitationSchema.parse(data.invitation);
        setLink(saved);
      }
      if (saved.state !== "active" || !saved.token) throw new Error("The invite link is unavailable. Reopen People to try again.");
      const url = `${window.location.origin}${groupInvitationPath(saved.token)}`;
      try {
        await navigator.clipboard.writeText(url);
        setFallbackURL(""); setNotice("Copied");
      } catch {
        setFallbackURL(url); setError("Couldn’t copy automatically. Select and copy the link below.");
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The invite link couldn’t be confirmed. Try again."); }
    finally { pending.current = false; setBusy(false); }
  }

  // An unconfirmed/ineligible account or an unknown initial load is not an
  // enabled invitation surface. Never carry a prior trip's control into it.
  if (!enabled || loadedSlug !== slug) return null;
  return <section className="group-invite-section" aria-label="Invite your group" data-analytics-exclude="true">
    <h3>Invite your group</h3>
    <p>Anyone with this link can sign in and join as a traveler.</p>
    {link?.state === "expired" || link?.state === "revoked" ? <p>{link.state === "expired" ? "The previous link expired." : "The previous link is disabled."} Share an invite link to create a new 14-day one.</p> : null}
    <div className="poll-action-row">
      <button className="cm-action cm-action--link" type="button" title="Copy invite link" disabled={busy} onClick={() => void copy()}>Share an invite link</button>
      <span className="people-notice people-notice--inline" role="status" aria-live="polite" aria-atomic="true">{notice}</span>
    </div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {fallbackURL ? <label className="field"><span>Invite link</span><input readOnly value={fallbackURL} onFocus={event => event.currentTarget.select()} /></label> : null}
  </section>;
}
