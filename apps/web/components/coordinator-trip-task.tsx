"use client";
import { useState } from "react";
import type { CoordinatorTripTaskProposal } from "@commons/contracts";
import { commonsViewPath } from "../lib/commons-route";

export function CoordinatorTripTask({ proposal, current, disabled, slug, threadId, ownerName, onAction }: {
  proposal: CoordinatorTripTaskProposal; current: boolean; disabled: boolean; slug: string; threadId?: string | null; ownerName: string;
  onAction: (operation: "apply" | "dismiss" | "undo") => Promise<void>;
}) {
  const [error, setError] = useState("");
  const act = async (operation: "apply" | "dismiss" | "undo") => {
    setError(""); try { await onAction(operation); } catch { setError("That task change wasn’t confirmed. Refresh to check what was saved before retrying."); }
  };
  if (proposal.quickAdd && proposal.state !== "pending") return <section className="workspace-work-section" aria-label="Task receipt">
    <p role="status">{proposal.state === "applied" ? "Task added" : "Task removed"} · {proposal.task.title}</p>
    {proposal.state === "applied" && proposal.receipt ? <div className="workspace-actions">
      <a className="cm-action" href={`${commonsViewPath(slug, "coordinator")}&todo=${proposal.receipt.id}${threadId ? `&thread=${threadId}` : ""}`}>View task</a>
      {current ? <button type="button" className="cm-action" disabled={disabled} onClick={() => void act("undo")}>Undo</button> : null}
    </div> : null}
    {error ? <p role="alert">{error}</p> : null}
  </section>;
  if (proposal.state !== "pending") return <details className="workspace-work-section"><summary>{proposal.state === "applied" ? "Task saved" : "Task suggestion dismissed"} · {proposal.task.title}</summary>
    {proposal.receipt ? <a href={`${commonsViewPath(slug, "coordinator")}&todo=${proposal.receipt.id}${threadId ? `&thread=${threadId}` : ""}`}>Open saved task</a> : <p>No task changed.</p>}
  </details>;
  return <section className="workspace-work-section" aria-label="Task suggestion"><h3>{proposal.task.title}</h3>
    <p className="review-caption">Requested by {ownerName} · Assigned to {ownerName} · {proposal.task.dueOn ?? "No due date"}</p>
    <p>Only this task will be saved. No booking, messages, supplier contact or changes to travel plans.</p>
    {current ? <div className="workspace-actions"><button type="button" className="cm-action cm-action--primary" disabled={disabled} onClick={() => void act("apply")}>Save task</button><button type="button" className="cm-action" disabled={disabled} onClick={() => void act("dismiss")}>Not now</button></div> : <p className="review-caption">Earlier version — review the latest task suggestion.</p>}
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
