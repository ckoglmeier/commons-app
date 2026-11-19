"use client";
import { TimeInput } from "./time-input";

import { useState } from "react";
import { formatPollSchedule, type PollAvailability, type PollQuestion, type PollSchedule } from "@commons/contracts";
import { newPollOption } from "@/lib/poll-builder";

type Choice = Extract<PollQuestion, { kind: "choice" }>;
const emptySchedule = (): PollSchedule => ({ startsOn: "", endsOn: "", startTime: "", endTime: "" });
export function newAvailabilityQuestion(timezone: string): Choice {
  return { id: crypto.randomUUID(), kind: "choice", prompt: "Which days work for you?", required: true,
    selectionMode: "multiple", availability: { mode: "days", timezone },
    options: [{ ...newPollOption("None of these works"), exclusive: true }] };
}

export function PollAvailabilityEditor({ question, onChange, initialMonth }: {
  question: Choice; onChange: (question: Choice) => void; initialMonth?: string;
}) {
  const availability = question.availability!;
  const candidates = question.options.filter(option => option.schedule);
  const [month, setMonth] = useState(() => candidates[0]?.schedule?.startsOn.slice(0, 7) || initialMonth?.slice(0, 7) || new Date().toISOString().slice(0, 7));
  const [pendingMode, setPendingMode] = useState<PollAvailability["mode"] | null>(null);
  const [zoneError, setZoneError] = useState("");
  function changeSettings(settings: PollAvailability, clear = false) {
    onChange({ ...question, availability: settings, options: question.options.filter(option => !clear || !option.schedule).map(option => option.schedule ? { ...option, label: formatPollSchedule(option.schedule, settings) } : option) });
    setPendingMode(null);
  }
  function add(schedule: PollSchedule) {
    if (question.options.length >= 12) return;
    const option = { ...newPollOption(formatPollSchedule(schedule, availability)), schedule };
    onChange({ ...question, options: [...candidates, option, ...question.options.filter(item => !item.schedule)] });
  }
  function update(id: string, schedule: PollSchedule) {
    onChange({ ...question, options: question.options.map(option => option.id === id ? { ...option, schedule, label: formatPollSchedule(schedule, availability) } : option) });
  }
  function remove(id: string) { onChange({ ...question, options: question.options.filter(option => option.id !== id) }); }
  const monthDate = new Date(`${month}-01T12:00:00Z`);
  const validMonth = Number.isFinite(monthDate.getTime());
  const dayCount = validMonth ? new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 0)).getUTCDate() : 0;
  function stepMonth(step: number) {
    const date = validMonth ? monthDate : new Date();
    date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + step);
    setMonth(date.toISOString().slice(0, 7));
  }
  return <div className="poll-availability-editor">
    <label className="fieldnotes-field"><span>What are you choosing?</span><select value={availability.mode} onChange={event => {
      const mode = event.target.value as PollAvailability["mode"];
      if (candidates.length) setPendingMode(mode); else changeSettings({ ...availability, mode });
    }}><option value="days">Days</option><option value="ranges">Trip date ranges</option><option value="times">Dates and times</option></select></label>
    {pendingMode ? <div className="poll-change-review" role="group" aria-label="Change date question type"><p>Changing the type removes these {candidates.length} date options. The question stays.</p><div className="poll-action-row"><button className="cm-action" type="button" onClick={() => setPendingMode(null)}>Keep these options</button><button className="cm-action" type="button" onClick={() => changeSettings({ ...availability, mode: pendingMode }, true)}>Change type</button></div></div> : null}
    {availability.mode === "days" ? <div className="poll-calendar">
      <div className="poll-calendar-heading"><button className="cm-action" type="button" aria-label="Previous month" onClick={() => stepMonth(-1)}>←</button><label><span className="sr-only">Month</span><input aria-label="Month" type="month" value={month} onChange={event => { if (event.target.value) setMonth(event.target.value); }} /></label><button className="cm-action" type="button" aria-label="Next month" onClick={() => stepMonth(1)}>→</button></div>
      <p className="poll-help">Pick the days to offer.</p>
      <div className="poll-calendar-grid" role="group" aria-label="Choose candidate days">
        {["S", "M", "T", "W", "T", "F", "S"].map((day, i) => <span aria-hidden="true" key={`weekday-${i}`}>{day}</span>)}
        {Array.from({ length: validMonth ? monthDate.getUTCDay() : 0 }, (_, i) => <span key={`space-${i}`} />)}
        {Array.from({ length: dayCount }, (_, i) => {
          const date = `${month}-${String(i + 1).padStart(2, "0")}`;
          const selected = candidates.find(option => option.schedule?.startsOn === date);
          const schedule = { ...emptySchedule(), startsOn: date, endsOn: date };
          return <button className="cm-action" key={date} type="button" aria-label={formatPollSchedule(schedule, availability)} aria-pressed={Boolean(selected)} disabled={!selected && question.options.length >= 12} onClick={() => selected ? remove(selected.id) : add(schedule)}>{i + 1}{selected ? <span aria-hidden="true">✓</span> : null}</button>;
        })}
      </div>
      <ul className="poll-selected-days">{candidates.map(option => <li key={option.id}><span>{option.label}</span><button className="cm-action cm-action--quiet" type="button" aria-label={`Remove ${option.label}`} onClick={() => remove(option.id)}>Remove</button></li>)}</ul>
    </div> : <>
      {availability.mode === "times" ? <label className="fieldnotes-field"><span>Timezone for every time</span><input value={availability.timezone} maxLength={100} list={`poll-timezones-${question.id}`} onChange={event => { changeSettings({ ...availability, timezone: event.target.value }); setZoneError(""); }} onBlur={() => {
        try { new Intl.DateTimeFormat("en-US", { timeZone: availability.timezone }); }
        catch { setZoneError("Choose a valid timezone before saving or sharing."); }
      }} /><datalist id={`poll-timezones-${question.id}`}>{["America/Denver", "America/New_York", "America/Chicago", "America/Los_Angeles", "Europe/London", "Europe/Paris", "Asia/Tokyo", "UTC"].map(value => <option key={value} value={value} />)}</datalist><small>Everyone sees the same timezone. No calendar access.</small>{zoneError ? <small role="alert">{zoneError}</small> : null}</label> : null}
      {candidates.map((option, index) => {
        const schedule = option.schedule!;
        return <fieldset className="poll-date-option" key={option.id}><legend>{availability.mode === "ranges" ? "Date range" : "Time option"} {index + 1}</legend><div className="poll-date-fields">
          <label className="fieldnotes-field"><span>{availability.mode === "ranges" ? "First day" : "Day"}</span><input type="date" value={schedule.startsOn} onChange={event => update(option.id, { ...schedule, startsOn: event.target.value, endsOn: availability.mode === "times" ? event.target.value : schedule.endsOn })} /></label>
          {availability.mode === "ranges" ? <label className="fieldnotes-field"><span>Last day</span><input type="date" min={schedule.startsOn || undefined} value={schedule.endsOn} onChange={event => update(option.id, { ...schedule, endsOn: event.target.value })} /></label> : <>
            <label className="fieldnotes-field"><span>From</span><TimeInput value={schedule.startTime} onChange={event => update(option.id, { ...schedule, startTime: event.target.value })} /></label>
            <label className="fieldnotes-field"><span>Until</span><TimeInput value={schedule.endTime} onChange={event => update(option.id, { ...schedule, endTime: event.target.value })} /></label>
          </>}
        </div><button className="cm-action cm-action--quiet" type="button" onClick={() => remove(option.id)} aria-label={`Remove date option ${index + 1}`}>Remove</button></fieldset>;
      })}
      <button className="cm-action" type="button" disabled={question.options.length >= 12} onClick={() => add(emptySchedule())}>{availability.mode === "ranges" ? "Add date range" : "Add time option"}</button>
    </>}
    <p className="poll-help">{candidates.length} of 11 date options · “None of these works” is included.</p>
  </div>;
}
