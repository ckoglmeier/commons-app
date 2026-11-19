"use client";

import Link from "next/link";
import { CommonsWordmark } from "@commons/ui";
import type { ReactNode } from "react";

export function PollWorkspaceHeader({ eventName, eventHref, eventLabel = "Back to trip", pollsHref, askHref, askLabel = "Ask the group", askCurrent = false, goalsHref, goalsCurrent = false, manageHref, onNavigate, busy = false, children, navigation }: {
  eventName: string;
  eventHref?: string;
  eventLabel?: string;
  pollsHref?: string;
  askHref?: string;
  askLabel?: string;
  askCurrent?: boolean;
  /** Beta trips (no Coordinator): the direct Goals page, beside Ask the group. */
  goalsHref?: string;
  goalsCurrent?: boolean;
  manageHref?: string;
  onNavigate?: (href: string) => void;
  busy?: boolean;
  children?: ReactNode;
  navigation?: ReactNode;
}) {
  function link(href: string, label: string, current = false) {
    return <Link href={href} aria-current={current ? "page" : undefined} aria-disabled={busy || undefined} onClick={event => {
      if (busy) { event.preventDefault(); return; }
      if (onNavigate && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onNavigate(href); }
    }}>{label}</Link>;
  }
  return <header className="poll-workspace-header">
    <div className="poll-organizer-header">
      <Link href="/" aria-label="Commons home" onClick={event => { if (busy || onNavigate) { event.preventDefault(); if (!busy) onNavigate?.("/"); } }}><CommonsWordmark /></Link>
      <span>{eventName}</span>
    </div>
    {navigation ?? <nav className="poll-workspace-links" aria-label={askHref ? "Trip and organizer navigation" : "Poll navigation"}>
      {eventHref ? link(eventHref, eventLabel) : link("/trips", "Your trips")}
      {askHref ? link(askHref, askLabel, askCurrent) : null}
      {goalsHref ? link(goalsHref, "Questions", goalsCurrent) : null}
      {pollsHref ? link(pollsHref, "Polls") : null}
      {manageHref ? link(manageHref, "Manage poll") : null}
    </nav>}
    {children}
  </header>;
}
