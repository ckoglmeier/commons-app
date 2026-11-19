"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import {
  DEFAULT_WORK_RATIO, FALLBACK_METRICS, clampRatio, fitsSplit, ratioBounds, ratioForKey, ratioFromPointer, resolveMetrics, separatorValues, surfaceMode,
  type LayoutMetrics, type SurfaceMode,
} from "@/lib/workspace-presentation";

/**
 * Presentation only: a mounted Work slot (left), a keyboard-operable separator, and a mounted conversation slot (right). It fetches and saves
 * nothing, and it never moves either subtree: hiding a surface sets `hidden` and `inert` on its slot, so editors and the composer keep their state.
 *
 * Whether the two surfaces sit side by side is decided by measuring this container (not the viewport) against the `--cm-workspace-*` tokens.
 * Until measured, one surface at a time is assumed, which is also the safe answer on a phone.
 */
export function WorkspacePaneLayout({ work, conversation, workOpen, expanded, ratio, onRatioChange, onRatioReset, onFitChange, separatorLabel = "Resize working material and conversation", workId }: {
  work: ReactNode;
  conversation: ReactNode;
  /** Work has been asked for (a result, document, review or Tasks). False keeps Work mounted but hidden; no empty column is reserved. */
  workOpen: boolean;
  /** Work takes the whole content area; the conversation is hidden and inert. */
  expanded: boolean;
  /** Work's share of the space beside the divider (0 to 1). Clamped here to what the container can hold. */
  ratio: number;
  /** `commit` is false while a pointer drag is in progress and true when it ends or a key is pressed. */
  onRatioChange: (ratio: number, commit: boolean) => void;
  /** Double-click or Enter on the separator restores the default width. */
  onRatioReset?: () => void;
  /** Reports whether split fits, so a header can offer the right return action. */
  onFitChange?: (fits: boolean) => void;
  separatorLabel?: string;
  workId?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ width: number; metrics: LayoutMetrics }>({ width: 0, metrics: FALLBACK_METRICS });
  const { width, metrics } = box;
  const fits = fitsSplit(width, metrics);
  const mode: SurfaceMode = surfaceMode({ workOpen, expanded, fits });
  const generatedId = useId();
  const workSlotId = workId ?? `${generatedId}-work`;
  const dragging = useRef(false);

  const measure = useCallback(() => {
    const element = root.current;
    if (!element) return;
    const style = getComputedStyle(element);
    const next = resolveMetrics(name => style.getPropertyValue(name), parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);
    const nextWidth = element.getBoundingClientRect().width;
    setBox(value => value.width === nextWidth && value.metrics.workMin === next.workMin && value.metrics.conversationMin === next.conversationMin && value.metrics.divider === next.divider ? value : { width: nextWidth, metrics: next });
  }, []);

  // Measured before the first paint so a wide window opens split rather than flashing one surface.
  useLayoutEffect(() => {
    measure();
    const element = root.current;
    if (!element) return;
    if (typeof ResizeObserver === "undefined") { window.addEventListener("resize", measure); return () => window.removeEventListener("resize", measure); }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [measure]);

  useLayoutEffect(() => { onFitChange?.(fits); }, [fits, onFitChange]);

  const bounds = ratioBounds(width, metrics);
  const effective = clampRatio(ratio, width, metrics);
  const values = separatorValues(effective, bounds);
  const split = mode === "split";
  const style: CSSProperties | undefined = split ? { gridTemplateColumns: `minmax(0, ${effective}fr) var(--cm-workspace-divider-width) minmax(0, ${1 - effective}fr)` } : undefined;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" && onRatioReset) { event.preventDefault(); onRatioReset(); return; }
    const next = ratioForKey(event.key, effective, bounds, event.shiftKey);
    if (next === null) return;
    event.preventDefault();
    onRatioChange(next, true);
  }
  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !split) return;
    dragging.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.currentTarget.focus();
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragging.current || !root.current) return;
    const rect = root.current.getBoundingClientRect();
    onRatioChange(ratioFromPointer(event.clientX, rect, metrics), false);
  }
  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (!dragging.current || !root.current) return;
    dragging.current = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    onRatioChange(ratioFromPointer(event.clientX, root.current.getBoundingClientRect(), metrics), true);
  }

  const workHidden = mode === "conversation";
  const conversationHidden = mode === "full" || mode === "work";
  /* A focusable vertical separator is the WAI-ARIA window splitter: it is interactive although the lint rule only knows it as a separator. */
  return <div ref={root} className="workspace-pane-layout" data-mode={mode} data-fits={fits ? "true" : "false"} style={style}>
    <div className="workspace-pane-slot workspace-pane-slot--work" id={workSlotId} hidden={workHidden} inert={workHidden}>{work}</div>
    {/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- window splitter pattern */}
    <div
      className="workspace-pane-separator" role="separator" aria-orientation="vertical" aria-label={separatorLabel} title={onRatioReset ? "Drag or use arrow keys to resize. Double-click or Enter resets the width." : undefined} aria-controls={workSlotId}
      aria-valuenow={values.now} aria-valuemin={values.min} aria-valuemax={values.max} aria-valuetext={`Working material is ${values.now} percent of the width`}
      tabIndex={0} hidden={!split} onKeyDown={onKeyDown} onDoubleClick={onRatioReset} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}
    ><span aria-hidden="true" /></div>
    {/* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
    <div className="workspace-pane-slot workspace-pane-slot--conversation" hidden={conversationHidden} inert={conversationHidden}>{conversation}</div>
  </div>;
}

export { DEFAULT_WORK_RATIO };

/**
 * A hidden surface (`display: none`) loses its scroll offset. Remember where a scroller was while it could scroll, and put it back when it is shown
 * again, so returning to Work (or Tasks) never lands at the top. The owner decides when it is `visible`.
 */
export function useRetainedScroll(getElement: () => HTMLElement | null, visible: boolean) {
  const top = useRef(0);
  const wasVisible = useRef(visible);
  useEffect(() => {
    const target = getElement();
    if (!target) return;
    const onScroll = () => { top.current = target.scrollTop; };
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => target.removeEventListener("scroll", onScroll);
  }, [getElement]);
  useLayoutEffect(() => {
    const target = getElement();
    if (visible && !wasVisible.current && target) target.scrollTop = top.current;
    wasVisible.current = visible;
  }, [getElement, visible]);
}
