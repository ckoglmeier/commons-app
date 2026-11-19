"use client";
import { useId, type InputHTMLAttributes } from "react";
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "type" | "value"> & {
    value?: string;
    onChange?: (event: {
        target: {
            value: string;
        };
    }) => void;
};
/** Explicit AM/PM controls, independent of browser/OS clock preferences. */
export function TimeInput({ value = "", onChange, required, disabled, id, "aria-label": label = "Time" }: Props) {
    const generated = useId(), hour = value ? Number(value.split(":")[0]) : null, minute = value.split(":")[1] ?? "00";
    function update(part: "hour" | "minute" | "period", next: string) {
        if (part !== "hour" && hour === null)
            return;
        if (part === "hour" && !next) {
            onChange?.({ target: { value: "" } });
            return;
        }
        const h = part === "hour" ? Number(next) % 12 + (hour !== null && hour >= 12 ? 12 : 0) : part === "period" ? (hour ?? 0) % 12 + (next === "PM" ? 12 : 0) : hour ?? 0;
        onChange?.({ target: { value: `${String(h).padStart(2, "0")}:${part === "minute" ? next : minute}` } });
    }
    return <span className="clock-input"><span className="clock-input__part"><select id={id ?? generated} aria-label={`${label} hour`} required={required} disabled={disabled} value={hour === null ? "" : String(hour % 12 || 12)} onChange={event => update("hour", event.target.value)}><option value="">—</option>{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</select></span><span aria-hidden="true">:</span><span className="clock-input__part"><select aria-label={`${label} minutes`} disabled={disabled || hour === null} value={minute} onChange={event => update("minute", event.target.value)}>{Array.from({ length: 60 }, (_, i) => <option key={i} value={String(i).padStart(2, "0")}>{String(i).padStart(2, "0")}</option>)}</select></span><span className="clock-input__part"><select aria-label={`${label} AM or PM`} disabled={disabled || hour === null} value={hour !== null && hour >= 12 ? "PM" : "AM"} onChange={event => update("period", event.target.value)}><option>AM</option><option>PM</option></select></span></span>;
}
