"use client";

import { useEffect, useId, useRef } from "react";

export type ContextChoice = {
  /** The existing workspace selection value (`thread:…`, `draft:…`, `poll:…`, `note:…`). */
  value: string;
  title: string;
  /** The existing lifecycle label, such as Main conversation, Poll, Draft, Archived goal. */
  detail: string;
  /** An existing per-row lifecycle action (Archive / Restore); the owner performs it. */
  action?: { label: string; ariaLabel: string; run: () => void };
};
export type ContextGroup = { id: string; label: string; choices: ContextChoice[] };

/**
 * A compact picker for the conversation shown in the Coordinator: a button that opens a modal dialog (not a sidebar). It owns no data: groups and the
 * actions behind them come from the workspace, which keeps its existing selection, loading and archive behavior. Escape and the backdrop close it, and
 * focus returns to the button.
 */
export function CoordinatorContextSelector({ groups, selected, currentTitle, disabled = false, onChoose, onNew, newLabel = "New conversation", variant = "button" }: {
  groups: ContextGroup[];
  selected: string;
  currentTitle: string;
  /** "title": the trigger is the conversation title itself, with a chevron (the persistent header). */
  variant?: "button" | "title";
  /** Mirrors the workspace's busy / blocked / conflict state, as the old thread list did. */
  disabled?: boolean;
  onChoose: (value: string) => void;
  onNew?: () => void;
  newLabel?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  function open() {
    const element = dialog.current;
    if (!element || element.open) return;
    if (typeof element.showModal === "function") element.showModal(); else element.setAttribute("open", "");
  }
  function close() {
    const element = dialog.current;
    if (!element?.open) return;
    if (typeof element.close === "function") element.close(); else element.removeAttribute("open");
    trigger.current?.focus();
  }
  // The browser closes the dialog on Escape; return focus to the live opener when it does.
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const onClose = () => { trigger.current?.focus(); };
    element.addEventListener("close", onClose);
    return () => element.removeEventListener("close", onClose);
  }, []);

  const total = groups.reduce((count, group) => count + group.choices.length, 0);
  const triggerButton = <button ref={trigger} type="button" className={variant === "title" ? "workspace-selector-title" : "workspace-selector-trigger cm-action"} aria-haspopup="dialog" aria-label={variant === "title" ? `${currentTitle}. Switch conversation` : `Conversations, current: ${currentTitle}`} title={variant === "title" ? "Switch conversation" : currentTitle} onClick={open}>
      <span>{variant === "title" ? currentTitle : "Conversations"}</span><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>;
  return <>
    {variant === "title" ? <h1 className="workspace-context" aria-live="polite">{triggerButton}</h1> : triggerButton}
    {/* The backdrop click is a pointer convenience; Escape and the Close button are the keyboard paths. */}
    {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */}
    <dialog
      ref={dialog} className="workspace-selector-dialog" aria-labelledby={titleId}
      onClick={event => { if (event.target === event.currentTarget) close(); }}
    >
      <div className="workspace-selector-panel">
        <header>
          <h2 id={titleId}>Conversations</h2>
          <button type="button" className="cm-action" onClick={close}>Close</button>
        </header>
        <div className="workspace-selector-body">
          {onNew ? <button type="button" className="cm-action cm-action--primary workspace-selector-new" disabled={disabled} onClick={() => { close(); onNew(); }}>{newLabel}</button> : null}
          {groups.filter(group => group.choices.length).map(group => <section key={group.id} aria-labelledby={`${titleId}-${group.id}`}>
            <h3 id={`${titleId}-${group.id}`}>{group.label}</h3>
            <ul>{group.choices.map(choice => <li key={choice.value} className="workspace-selector-row">
              <button type="button" className="workspace-thread workspace-selector-choice" aria-current={choice.value === selected ? "true" : undefined} disabled={disabled} onClick={() => { close(); if (choice.value !== selected) onChoose(choice.value); }}>
                <span className="workspace-thread-title">{choice.title}</span>
                <span className="workspace-thread-meta">{choice.detail}{choice.value === selected ? " · Selected" : ""}</span>
              </button>
              {choice.action ? <button type="button" className="workspace-thread-action" disabled={disabled} aria-label={choice.action.ariaLabel} title={choice.action.label} onClick={() => choice.action!.run()}>{choice.action.label}</button> : null}
            </li>)}</ul>
          </section>)}
          {total === 0 && !onNew ? <p className="review-caption">Conversations will appear here as you work through the trip.</p> : null}
        </div>
      </div>
    </dialog>
  </>;
}
