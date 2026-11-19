"use client";

import Link from "next/link";

import { commonsViewPath, type EventView } from "@/lib/commons-route";
import { CalendarIcon, HomeIcon, ImageIcon, LockIcon, WalletIcon } from "./icons";

export const eventNavigationItems = [
  { id: "home", label: "Trip", icon: HomeIcon },
  { id: "plan", label: "Plan", icon: CalendarIcon },
  { id: "money", label: "Money", icon: WalletIcon },
  { id: "moments", label: "Photos", icon: ImageIcon },
] as const;

export function EventNavigationLinks({ eventId, view, navigate, busy = false, tripStage = null }: {
  /** New experience only: Trip · Plan · Money · Photos, with the last two marked until the trip is going. Null keeps Photos contextual under Trip, as before. */
  tripStage?: "deciding" | "going" | null;
  eventId: string; view: EventView; navigate: (view: EventView) => void; busy?: boolean;
}) {
  // Photos (moments) is contextual under Trip; Travel & stays (logistics) is a section of Plan.
  const primary = view === "logistics" ? "plan" : view === "moments" ? (tripStage ? "moments" : "home") : view;
  return <>{eventNavigationItems.filter(item => (item.id !== "moments" || tripStage !== null)).map(item => {
    const Icon = item.icon;
    return <Link key={item.id} href={commonsViewPath(eventId, item.id)} aria-current={primary === item.id ? "page" : undefined} className={primary === item.id ? "active" : ""} onClick={event => {
      if (busy) { event.preventDefault(); return; }
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      navigate(item.id);
    }}><Icon /><span>{item.label}</span>{tripStage === "deciding" && item.id === "moments" ? <span className="event-nav-lock"><LockIcon /><span className="sr-only"> (opens when you’re going)</span></span> : null}</Link>;
  })}</>;
}
