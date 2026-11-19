"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { readUnsent, transferUnsent, type UnsentDestination } from "@/lib/coordinator-unsent";

/** Legacy Trip-page (Overview) drafts remain recoverable. The rail's Coordinator is the ordinary entry, so this renders nothing without a saved draft. */
export function CoordinatorHomeEntry({ slug, actorId, main, onContinue, personal = false }: {
  slug: string; actorId: string;
  main?: { threadId: string; turnVersion: number; label?: string }; onContinue?: () => void; personal?: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState("");
  const target: UnsentDestination = personal ? "personal" : main ? `thread:${main.threadId}` as const : "new" as const;
  useEffect(() => {
    const frame = requestAnimationFrame(() => setText(value => value || readUnsent(slug, actorId, "overview")));
    return () => cancelAnimationFrame(frame);
  }, [slug, actorId]);
  function open() { if (onContinue) onContinue(); else router.push(`/c/${encodeURIComponent(slug)}/coordinator`); }
  function continueDraft(replace = false) {
    const outcome = transferUnsent(slug, actorId, "overview", target, text, replace);
    setConflict(outcome === "conflict");
    if (outcome === "unavailable") { setError("Your draft is still here. Draft storage is unavailable in this browser; copy the text before opening Coordinator."); return; }
    if (outcome === "transferred") { setText(""); open(); }
  }
  if (!text && !conflict && !error) return null;
  return <section className="coordinator-home-entry" aria-label="Saved draft for Coordinator">
    {text ? <details className="coordinator-home-entry__saved"><summary>Saved Trip-page draft</summary><p>{text}</p><button className="cm-action" type="button" onClick={() => continueDraft()}>Use this draft in Coordinator</button></details> : null}
    {conflict ? <div className="cm-note" role="status"><p>Coordinator already has an unsent draft. Both drafts are kept until you choose.</p><div className="coordinator-home-entry__actions"><button className="cm-action" type="button" onClick={open}>Keep Coordinator draft</button><button className="cm-action" type="button" onClick={() => continueDraft(true)}>Use Overview draft</button></div></div> : null}
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
