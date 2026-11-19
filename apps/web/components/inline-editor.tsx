"use client";

import { useEffect, useRef, type ReactNode } from "react";

// Inline editors do not trap focus or lock page scrolling like a dialog.
export function InlineEditor({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.querySelector<HTMLElement>("input:not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled)")?.focus();
    return () => { if (trigger?.isConnected) trigger.focus(); };
  }, []);
  return <div className="event-inline-editor" ref={ref}>{children}</div>;
}
