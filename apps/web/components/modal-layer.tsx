"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function ModalLayer({ close, children }: { close: () => void; children: ReactNode }) {
  const layerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);

  useEffect(() => {
    closeRef.current = close;
  }, [close]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => {
      layerRef.current?.querySelector<HTMLElement>(".sheet button:not(:disabled), .sheet input:not(:disabled), .sheet [href], .sheet [tabindex]:not([tabindex='-1'])")?.focus();
    }, 0);

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !layerRef.current) return;
      const focusable = Array.from(new Set([
        ...layerRef.current.querySelectorAll<HTMLElement>("button:not(:disabled):not([tabindex='-1']), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex='-1'])"),
        ...document.querySelectorAll<HTMLElement>("[data-modal-accessory] button:not(:disabled), button[data-modal-accessory]:not(:disabled)"),
      ])).filter(element => !element.closest("[inert]") && element.getClientRects().length > 0);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  return (
    <div className="modal-layer" ref={layerRef}>
      <button className="modal-scrim" tabIndex={-1} onClick={close} aria-label="Close dialog" />
      {children}
    </div>
  );
}

