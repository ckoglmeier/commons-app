"use client";
import { useId, useState, type ReactNode } from "react";

export type GoalStage = "build" | "share" | "decide";
/** Keep closed panels mounted so moving stages cannot discard unsaved work. */
export function GoalStages({ initialStage, build, share, decide }: { initialStage: GoalStage; build: ReactNode; share: ReactNode; decide: ReactNode }) {
  const [open, setOpen] = useState<GoalStage | null>(initialStage), id = useId();
  return <div className="goal-stages">{([
    ["build", "Build", build], ["share", "Share", share], ["decide", "Decide", decide],
  ] as const).map(([stage, label, content]) => <section className="goal-stage" key={stage}>
    <h2 className="goal-stage__heading"><button type="button" aria-label={label} aria-expanded={open === stage} aria-controls={`${id}-${stage}`} onClick={() => setOpen(open === stage ? null : stage)}><span>{label}</span><span aria-hidden="true">{open === stage ? "−" : "+"}</span></button></h2>
    <div id={`${id}-${stage}`} hidden={open !== stage} className="goal-stage__body">{content}</div>
  </section>)}</div>;
}
