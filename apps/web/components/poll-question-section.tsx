"use client";

import { useState, type ReactNode } from "react";

/** Independent sections keep the whole poll visible and allow side-by-side editing. */
export function PollQuestionSection({ id, title, meta, initiallyOpen = false, children }: {
  id: string; title: string; meta: string; initiallyOpen?: boolean; children?: ReactNode;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  return <section className="poll-question-section">
    <button className="cm-action poll-question-section__toggle" type="button" aria-expanded={open} aria-controls={`question-${id}`} onClick={() => setOpen(!open)}>
      <span><strong>{title}</strong><small>{meta}</small></span><span>{open ? "Collapse" : "Edit"}</span>
    </button>
    <div id={`question-${id}`} hidden={!open}>{children}</div>
  </section>;
}
