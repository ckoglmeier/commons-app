"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { recipeRequest, stableCommand } from "@/lib/recipe-client";

export function RecipeDraftDelete({ slug, runId, version, title, archived = false, leave = false }: {
  slug: string; runId: string; version: number; title: string; archived?: boolean; leave?: boolean;
}) {
  const router = useRouter(), command = useRef<{ key: string; id: string } | null>(null);
  const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true); setError(null);
    const body = { expectedDraftVersion: version, archived: !archived };
    command.current = stableCommand(command.current, body);
    const result = await recipeRequest(`/api/v1/commons/${encodeURIComponent(slug)}/recipes/${runId}/archive`, "POST", { ...body, commandId: command.current.id });
    if (result.ok) {
      setConfirm(false);
      if (leave) router.push(`/c/${encodeURIComponent(slug)}/recipes?view=deleted`);
      router.refresh();
    } else { setError(result.error); if (result.code === "conflict") router.refresh(); }
    setBusy(false);
  }
  return <div className="recipe-draft-action">
    {confirm ? <div className="recipe-confirm"><p>Delete “{title}”? You can restore it from Deleted drafts.</p>
      <button className="cm-action" disabled={busy} onClick={() => void save()}>{busy ? "Deleting…" : "Delete draft"}</button>
      <button className="cm-action" disabled={busy} onClick={() => setConfirm(false)}>Keep draft</button>
    </div> : <button type="button" className="cm-action" disabled={busy} onClick={() => archived ? void save() : setConfirm(true)}>{busy ? "Restoring…" : archived ? "Restore draft" : "Delete draft"}</button>}
    {error ? <p role="alert" className="recipe-error">{error}</p> : null}
  </div>;
}
