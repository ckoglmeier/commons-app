"use client";

import { CommonsMark } from "@commons/ui";
import Link from "next/link";
import { commonsPath, PUBLIC_DEMO_COMMONS_ID } from "@/lib/commons-route";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { FeedbackSheet } from "./feedback-sheet";
import { LogInIcon, LogOutIcon, MessageIcon, PlusIcon, RouteIcon } from "./icons";

export function AccountMenu({
  initials,
  label = "Account",
  canSignOut,
  feedbackCommonsSlug = "product",
  operator = false,
  inline = false,
  showTrips = true,
  variant = "avatar",
  roleLabel,
}: {
  initials: string;
  label?: string;
  canSignOut: boolean;
  feedbackCommonsSlug?: string;
  operator?: boolean;
  inline?: boolean;
  /** Off where the page already shows "Your trips" (the trip rail and Menu). */
  showTrips?: boolean;
  /** "rail" shows the name and role beside the initials (persistent rail foot); behavior is unchanged. */
  variant?: "avatar" | "rail";
  roleLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [feedbackRequested, setFeedbackRequested] = useState(false);
  const pathname = usePathname();
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    function closeFromOutside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function closeFromKeyboard(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || !rootRef.current?.contains(document.activeElement)) return;
      const items = Array.from(rootRef.current.querySelectorAll<HTMLElement>("[role='menuitem']"));
      if (!items.length) return;
      event.preventDefault();
      const currentIndex = items.indexOf(document.activeElement as HTMLElement);
      const nextIndex = event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowUp"
            ? (currentIndex - 1 + items.length) % items.length
            : (currentIndex + 1) % items.length;
      items[nextIndex]?.focus();
    }

    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromKeyboard);
    const focusTimer = window.setTimeout(() => {
      rootRef.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus();
    }, 0);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeFromKeyboard);
    };
  }, [open]);

  const items = <>
    <Link href="/new" role="menuitem" onClick={() => setOpen(false)} data-analytics-event="event_creation_viewed" data-analytics-detail="account_menu"><PlusIcon /><span>Start new event</span></Link>
    {showTrips ? <Link href="/trips" role="menuitem" onClick={() => setOpen(false)}><RouteIcon /><span>Your trips</span></Link> : null}
    {canSignOut ? <Link href="/profile" role="menuitem" onClick={() => setOpen(false)}><span aria-hidden="true">○</span><span>Your profile</span></Link> : null}
    {operator ? <Link href="/admin" role="menuitem" onClick={() => setOpen(false)}><span aria-hidden="true">⚙</span><span>Pilot admin</span></Link> : null}
    {pathname !== commonsPath(PUBLIC_DEMO_COMMONS_ID) ? <Link href={commonsPath(PUBLIC_DEMO_COMMONS_ID)} role="menuitem" onClick={() => setOpen(false)} data-analytics-event="demo_opened" data-analytics-commons="cape-cod-couples-week" data-analytics-detail="account_menu"><CommonsMark /><span>View demo</span></Link> : null}
    {canSignOut ? <button type="button" role="menuitem" onClick={() => { setOpen(false); setFeedbackRequested(true); }} data-analytics-event="feedback_opened" data-analytics-commons={feedbackCommonsSlug} data-analytics-detail="account_menu"><MessageIcon /><span>Give feedback</span></button> : null}
    {canSignOut ? <form action="/auth/sign-out" method="post"><button type="submit" role="menuitem"><LogOutIcon /><span>Sign out</span></button></form> : <Link href={`/sign-in?next=${encodeURIComponent(pathname)}`} role="menuitem" onClick={() => setOpen(false)} data-analytics-event="sign_in_started" data-analytics-detail="account_menu"><LogInIcon /><span>Sign in</span></Link>}
  </>;
  if (inline) return <><div className="account-menu__inline" role="menu" aria-label={label}>{items}</div>{canSignOut ? <FeedbackSheet open={feedbackRequested} close={() => setFeedbackRequested(false)} commonsSlug={feedbackCommonsSlug} respondentName={label === "Account" ? undefined : label} /> : null}</>;
  return (
    <>
      <div className={`account-menu${variant === "rail" ? " account-menu--rail" : ""}`} ref={rootRef}>
      <button
        ref={triggerRef}
        className={variant === "rail" ? "account-menu__rail-trigger" : "profile-avatar"}
        type="button"
        aria-label={`${label} menu`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={label}
        onClick={() => setOpen((current) => !current)}
      >
        {variant === "rail" ? <>
          <span className="account-menu__initials" aria-hidden="true">{initials}</span>
          <span className="account-menu__who"><strong>{label}</strong>{roleLabel ? <small>{roleLabel}</small> : null}</span>
        </> : initials}
      </button>
      {open ? (
        <div className="account-menu__popover" id={menuId} role="menu" aria-label={label}>
          {items}
        </div>
      ) : null}
      </div>
      {canSignOut ? (
        <FeedbackSheet
          open={feedbackRequested}
          close={() => { setFeedbackRequested(false); requestAnimationFrame(() => triggerRef.current?.focus()); }}
          commonsSlug={feedbackCommonsSlug}
          respondentName={label === "Account" ? undefined : label}
        />
      ) : null}
    </>
  );
}
