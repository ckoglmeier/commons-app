"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CommonsWordmark } from "@commons/ui";
import { commonsPath, type EventView } from "@/lib/commons-route";
import { EventNavigationLinks } from "./event-navigation";
import { AccountMenu } from "./account-menu";

export function GlobalNavigation({
  tab,
  setTab,
  actorName,
  actorInitials,
  signedIn,
  commonsId,
  commonsSlug,
  openFeedback,
  canUseWorkspace,
  onNavigate,
  busy = false,
  accountInNavigation = false,
}: {
  tab: EventView | "workspace";
  setTab: (tab: EventView) => void;
  actorName: string;
  actorInitials: string;
  signedIn: boolean;
  commonsId: string;
  commonsSlug: string;
  openFeedback?: () => void;
  canUseWorkspace: boolean;
  onNavigate?: (href: string) => void;
  busy?: boolean;
  accountInNavigation?: boolean;
}) {
  const menu = useRef<HTMLDialogElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const desktop = window.matchMedia("(min-width: 1100px)");
    const closeOnDesktop = () => { if (desktop.matches) menu.current?.close(); };
    desktop.addEventListener("change", closeOnDesktop);
    return () => { document.body.style.overflow = previousOverflow; desktop.removeEventListener("change", closeOnDesktop); };
  }, [menuOpen]);
  const closeMenu = () => menu.current?.close();
  return (
    <header className="global-nav" data-account-in-navigation={accountInNavigation}>
      <Link className="brand-lockup" href="/" aria-label="Commons homepage" title="Commons homepage" aria-disabled={busy || undefined} onClick={event => { if (busy) { event.preventDefault(); return; } if (onNavigate && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onNavigate("/"); } }}>
        <CommonsWordmark />
      </Link>
      <nav aria-label="Primary navigation">
        <EventNavigationLinks eventId={commonsId} view={tab} navigate={setTab} canUseWorkspace={canUseWorkspace} onNavigate={onNavigate} busy={busy} />
      </nav>
      <div className="workspace-actions">
        <button ref={menuButton} type="button" className="trip-menu-toggle" aria-haspopup="dialog" aria-expanded={menuOpen} aria-controls="trip-navigation-menu" disabled={busy} onClick={() => { menu.current?.showModal(); setMenuOpen(true); }}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 6h16M4 12h16M4 18h16" /></svg>Menu</button>
        {openFeedback ? <button className="workspace-feedback" type="button" onClick={openFeedback}>Give feedback</button> : null}
        <div className="global-account-action">{signedIn ? (
          <AccountMenu initials={actorInitials} label={actorName} canSignOut feedbackCommonsSlug={commonsSlug} />
        ) : (
          <Link className="global-sign-in" href={`/sign-in?next=${encodeURIComponent(commonsPath(commonsId))}`}>Sign in</Link>
        )}</div>
      </div>
      <dialog ref={menu} className="trip-navigation-menu" id="trip-navigation-menu" aria-labelledby="trip-menu-title" onClose={() => { setMenuOpen(false); menuButton.current?.focus(); }}>
        <div className="trip-menu-heading"><h2 id="trip-menu-title">Your trip</h2><button className="cm-action" type="button" onClick={closeMenu}>Close</button></div>
        <nav aria-label="Trip navigation"><EventNavigationLinks eventId={commonsId} view={tab} canUseWorkspace={canUseWorkspace} busy={busy} navigate={view => { closeMenu(); setTab(view); }} onNavigate={onNavigate ? href => { closeMenu(); onNavigate(href); } : undefined} /></nav>
        {accountInNavigation ? <section className="trip-menu-account" aria-label="Account"><h3>{signedIn ? actorName : "Account"}</h3>{signedIn ? <AccountMenu inline initials={actorInitials} label={actorName} canSignOut feedbackCommonsSlug={commonsSlug} /> : <nav aria-label="Account navigation"><Link href={`/sign-in?next=${encodeURIComponent(commonsPath(commonsId))}`}>Sign in</Link></nav>}</section> : null}
      </dialog>
    </header>
  );
}
