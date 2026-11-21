"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { PlusIcon } from "./icons";

export type LogisticsAddKind = "thing" | "meal" | "flight" | "transport" | "stay";
export function logisticsAddOptions(_canAddStay: boolean): Array<{ kind: LogisticsAddKind; label: string }> {
  void _canAddStay; // All entry points keep the same choices; permission is shown on the Lodging action.
  return [
    { kind: "thing", label: "Activity" },
    { kind: "meal", label: "Meal" },
    { kind: "flight", label: "Flight" },
    { kind: "transport", label: "Transport" },
    { kind: "stay", label: "Lodging" },
  ];
}

export function LogisticsAddMenu({ canAddStay, disabled = false, choose, addPhotos, addReceipt }: {
  addPhotos?: () => void; addReceipt?: () => void;
  canAddStay: boolean; disabled?: boolean; choose: (kind: LogisticsAddKind) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number; maxHeight: number }>();
  const menuId = useId();
  useLayoutEffect(() => {
    if (!open) return;
    function placeMenu() {
      if (!root.current || !menu.current) return;
      const bounds = root.current.getBoundingClientRect();
      const viewport = window.visualViewport;
      const leftEdge = (viewport?.offsetLeft ?? 0) + 16;
      const topEdge = (viewport?.offsetTop ?? 0) + 16;
      const rightEdge = leftEdge + (viewport?.width ?? window.innerWidth) - 32;
      const bottomEdge = topEdge + (viewport?.height ?? window.innerHeight) - 32;
      const left = Math.max(leftEdge, Math.min(bounds.right - menu.current.offsetWidth, rightEdge - menu.current.offsetWidth));
      const below = Math.max(44, bottomEdge - bounds.bottom - 8);
      const above = Math.max(44, bounds.top - topEdge - 8);
      const upwards = below < menu.current.scrollHeight && above > below;
      const maxHeight = upwards ? above : below;
      setPosition({ left: left - bounds.left, top: upwards ? -Math.min(menu.current.scrollHeight, maxHeight) - 8 : bounds.height + 8, maxHeight });
    }
    placeMenu();
    window.addEventListener("resize", placeMenu);
    window.addEventListener("scroll", placeMenu, true);
    window.visualViewport?.addEventListener("resize", placeMenu);
    window.visualViewport?.addEventListener("scroll", placeMenu);
    return () => {
      window.removeEventListener("resize", placeMenu);
      window.removeEventListener("scroll", placeMenu, true);
      window.visualViewport?.removeEventListener("resize", placeMenu);
      window.visualViewport?.removeEventListener("scroll", placeMenu);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const first = root.current?.querySelector<HTMLElement>("[role='menuitem']");
    first?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  function keyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (event.key === "Escape") { event.preventDefault(); setOpen(false); trigger.current?.focus(); return; }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (!open) { setOpen(true); return; }
    const items = [...(root.current?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
    items[next]?.focus();
  }
  return <div className="logistics-add" ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button className="logistics-add-trigger" ref={trigger} type="button" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} aria-disabled={disabled} onKeyDown={keyDown} onClick={() => { if (!disabled) setOpen(!open); }}><PlusIcon /> Add</button>
    {open ? <div className="logistics-add-options" ref={menu} style={position} id={menuId} role="menu" aria-label="Add to trip">
      {logisticsAddOptions(canAddStay).map(option => <button type="button" role="menuitem" aria-label={option.label} tabIndex={-1} aria-disabled={option.kind === "stay" && !canAddStay} key={option.kind} onKeyDown={keyDown} onClick={() => {
        if (option.kind === "stay" && !canAddStay) return;
        setOpen(false);
        // The inline editor restores focus to this stable trigger when closed.
        trigger.current?.focus({ preventScroll: true });
        choose(option.kind);
      }}><span>{option.label}</span></button>)}
      {[{ label: "Photos", action: addPhotos }, { label: "Cost from a receipt", action: addReceipt }].filter(option => option.action).map(option => <button key={option.label} type="button" role="menuitem" tabIndex={-1} onKeyDown={keyDown} onClick={() => { setOpen(false); trigger.current?.focus({ preventScroll: true }); option.action?.(); }}><span>{option.label}</span></button>)}
      {!canAddStay ? <p className="event-logistics-note">Organizers can add shared stays.</p> : null}
    </div> : null}
  </div>;
}
