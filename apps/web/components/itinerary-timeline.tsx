"use client";

import type { ReactNode } from "react";
import type { ItineraryContent } from "@commons/contracts";
import { useItinerarySectionReorder, reorderSections } from "./itinerary-section-reorder";
import { clockTime } from "@/lib/clock-time";

type Item = ItineraryContent["items"][number];
const dayHeading = (day: string) => new Intl.DateTimeFormat("en-US", {
  weekday: "long", month: "long", day: "numeric", timeZone: "UTC",
}).format(new Date(`${day}T12:00:00Z`));

/** Keep supplied order within each day and never invent missing times. */
export function ItineraryTimeline({ items, renderDetails, renderSelection, renderDay, renderTitle, savedIds, dayOrder = [], onReorderDays }: {
  dayOrder?: string[]; onReorderDays?: (order:string[])=>void; renderTitle?: (item: Item) => ReactNode; renderDay?: (day: string) => ReactNode; items: Item[]; renderDetails: (item: Item) => ReactNode; renderSelection?: (item: Item) => ReactNode; savedIds?: ReadonlySet<string>;
}) {
  const chronological=[...new Set(items.flatMap(item => item.day ? [item.day] : []))].sort();
  const days=[...new Set([...dayOrder,...chronological])];
  const reorder=useItinerarySectionReorder((source,target)=>onReorderDays?.(reorderSections(days,source,target,day=>day)),!onReorderDays);
  const groups = [...days.map(day => ({ day, title: dayHeading(day), items: items.filter(item => item.day === day) })),
    ...(items.some(item => !item.day) ? [{ day: null, title: "Unscheduled interests and ideas", items: items.filter(item => !item.day) }] : [])];
  return <div className="itinerary-timeline">
    {groups.map(group => <section key={group.day ?? "unscheduled"} className="itinerary-day" {...(group.day && onReorderDays ? reorder.sectionProps(group.day) : {})}>
      <h4>{group.title}</h4>{group.day && onReorderDays ? <div className="workspace-actions"><button type="button" className="cm-action itinerary-section-handle" aria-label={`Drag ${group.title} section`} {...reorder.handleProps(group.day)}>⠿<span className="sr-only">Drag section</span></button>{([-1,1] as const).map(direction=><button type="button" key={direction} className="cm-action" disabled={!days[days.indexOf(group.day!)+direction]} onClick={()=>onReorderDays(reorderSections(days,group.day!,days[days.indexOf(group.day!)+direction],day=>day))}>Move section {direction<0 ? "earlier" : "later"}</button>)}</div> : null}{group.day && renderDay ? renderDay(group.day) : null}
      {group.items.map(item => <div key={item.id} className="itinerary-timeline-row" data-selectable={Boolean(renderSelection)}>
        {renderSelection ? <div className="itinerary-timeline-selection">{renderSelection(item)}</div> : null}
        <details className="itinerary-stop">
          <summary>
            <span className="itinerary-time">{item.time ? `${clockTime(item.time)}${item.endTime ? `–${clockTime(item.endTime)}` : ""}` : item.day ? "Time open" : "Day open"}</span>
            <span className="itinerary-row-title">{renderTitle ? renderTitle(item) : item.title.replace(/^(Thursday|Friday|Saturday|Sunday|Monday|Tuesday|Wednesday)\s*[—–-]\s*/i, "").replace(/^./, letter => letter.toUpperCase())}{item.participation === "optional" ? <small>Optional</small> : null}{item.alternative ? <small>Alternative</small> : null}{item.travelAnchor ? <small>Flight context</small> : null}{item.decision ? <small>Vote proposed</small> : null}{savedIds?.has(item.id) ? <small>Saved</small> : null}</span>
            <span aria-hidden="true" className="itinerary-caret">›</span>
          </summary>
          <div className="itinerary-stop-details">{renderDetails(item)}</div>
        </details>
      </div>)}
    </section>)}
  </div>;
}
