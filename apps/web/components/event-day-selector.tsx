"use client";
import type { DragEvent } from "react";
import type { DayOption } from "@/lib/plan-days";

export function EventDaySelector({ days, selected, select, label, dropDay, dragging, allowDrop, leaveDrop, drop }: {
  days: DayOption[]; selected: string; select: (id: string) => void; label: string;
  dropDay?: string | null; dragging?: boolean;
  allowDrop?: (event: DragEvent<HTMLElement>, id: string) => void;
  leaveDrop?: (id: string) => void;
  drop?: (event: DragEvent<HTMLElement>, id: string) => void;
}) {
  const currentDays = days.filter(day => !day.outsideTrip);
  const outsideDays = days.filter(day => day.outsideTrip);
  const renderDays = (options: DayOption[]) => options.map(day => <button key={day.id} type="button" role="tab" aria-selected={selected === day.id}
      className={`${selected === day.id ? "active" : ""}${dropDay === day.id ? " idea-drop-target" : ""}`}
      onClick={() => select(day.id)} onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const index = options.findIndex(item => item.id === day.id);
        const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (index + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1) + options.length) % options.length;
        select(options[next].id);
        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
      }} onDragEnter={event => allowDrop?.(event, day.id)} onDragOver={event => allowDrop?.(event, day.id)}
      onDragLeave={() => leaveDrop?.(day.id)} onDrop={event => drop?.(event, day.id)}>
      <span>{day.day}</span><strong>{day.date}</strong>
    </button>);
  return <div className={`day-strip${dragging ? " day-strip--idea-drop" : ""}`}>
    <div className="day-strip__current" role="tablist" aria-label={label}>{renderDays(currentDays)}</div>
    {outsideDays.length > 0 && <details className="day-strip__outside" open={outsideDays.some(day => day.id === selected) || undefined}><summary>Outside trip dates</summary><div role="tablist" aria-label="Outside trip dates">{renderDays(outsideDays)}</div></details>}
  </div>;
}
