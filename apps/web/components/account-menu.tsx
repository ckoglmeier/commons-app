"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { feedbackHref, useFeedbackEmail } from "./feedback-sheet";
import { LogInIcon, LogOutIcon, MessageIcon, PlusIcon, RouteIcon, UsersIcon } from "./icons";

export function AccountMenu({
  initials,
  label = "Account",
  canSignOut,
  inline = false,
  showTrips = true,
  variant = "avatar",
  roleLabel,
  instanceAdmin = false,
}: {
  initials: string;
  label?: string;
  canSignOut: boolean;
  inline?: boolean;
  /** Off where the page already shows "Start a new trip" and "Your trips" (the trip rail and Menu); hides both items here. */
  showTrips?: boolean;
  /** "rail" shows the name and role beside the initials (persistent rail foot); behavior is unchanged. */
  variant?: "avatar" | "rail";
  roleLabel?: string;
  /** True for the instance admin: adds "Who can join" (/settings/join). */
  instanceAdmin?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const feedbackEmail = useFeedbackEmail();
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
    {showTrips ? <Link href="/new" role="menuitem" onClick={() => setOpen(false)} data-analytics-event="event_creation_viewed" data-analytics-detail="account_menu"><PlusIcon /><span>Start a new trip</span></Link> : null}
    {showTrips ? <Link href="/trips" role="menuitem" onClick={() => setOpen(false)}><RouteIcon /><span>Your trips</span></Link> : null}
    {canSignOut ? <Link href="/profile" role="menuitem" onClick={() => setOpen(false)}><span aria-hidden="true">○</span><span>Your profile</span></Link> : null}
    {instanceAdmin ? <Link href="/settings/join" role="menuitem" onClick={() => setOpen(false)}><UsersIcon /><span>Who can join</span></Link> : null}
    {canSignOut && feedbackEmail ? <a href={`mailto:${feedbackEmail}`} role="menuitem" onClick={event => { event.currentTarget.href = feedbackHref(feedbackEmail); setOpen(false); }}><MessageIcon /><span>Give feedback</span></a> : null}
    {canSignOut ? <form action="/auth/sign-out" method="post"><button type="submit" role="menuitem"><LogOutIcon /><span>Sign out</span></button></form> : <Link href={`/sign-in?next=${encodeURIComponent(pathname)}`} role="menuitem" onClick={() => setOpen(false)} data-analytics-event="sign_in_started" data-analytics-detail="account_menu"><LogInIcon /><span>Sign in</span></Link>}
  </>;
  if (inline) return <><div className="account-menu__inline" role="menu" aria-label={label}>{items}</div></>;
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
    </>
  );
}
