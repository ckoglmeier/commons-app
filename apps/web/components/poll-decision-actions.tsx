"use client";

import Link from "next/link";
import { useState } from "react";
import type { PollDetail } from "@commons/contracts";
import { decisionHandoffPath, type DecisionAction } from "@/lib/decision-handoff";
import { commonsViewPath } from "@/lib/commons-route";

export function PollDecisionActions({ slug, poll }: { slug: string; poll: PollDetail }) {
  const [reviewed, setReviewed] = useState(false);
  if (!poll.decision || poll.currentActorRole !== "organizer") return null;
  const restricted = poll.decision.target === "record";
  // Choices that are trip stays become "make it our stay" rather than a blank new stay.
  const chosenStays = (poll.decision.selectedStayIds ?? []).flatMap(id => {
    const option = poll.questions.flatMap(question => question.kind === "choice" ? question.options : []).find(item => item.resource?.type === "stay" && item.resource.id === id);
    return option ? [{ id, label: option.label }] : [];
  });
  const actions: Array<{ action: DecisionAction; label: string }> = [
    { action: "dates", label: "Update dates" }, ...(chosenStays.length ? [] : [{ action: "stay" as const, label: "Add stay" }]),
    { action: "plan", label: poll.decision.target === "plan_idea" ? "Schedule this idea" : "Add a plan" },
  ];
  return <div className="decision-next-actions">
    <h3>Next steps</h3>
    
    {restricted ? <label className="decision-sharing-review"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />
      <span>I’ll check what I share with the whole group. Private answers won’t be copied.</span>
    </label> : null}
    <div className="decision-next-links">{chosenStays.map(stay => restricted && !reviewed
      ? <button type="button" className="view-secondary-action" disabled key={stay.id}>Make {stay.label} our stay</button>
      : <Link className="view-secondary-action" key={stay.id} href={`${commonsViewPath(slug, "plan")}&section=stays&confirmStay=${encodeURIComponent(stay.id)}`}>Make {stay.label} our stay</Link>)}
      {actions.map(({ action, label }) => restricted && !reviewed
      ? <button type="button" className="view-secondary-action" disabled key={action}>{label}</button>
      : <Link className="view-secondary-action" key={action} href={decisionHandoffPath(slug, poll.id, action)}>{label}</Link>)}</div>
  </div>;
}
