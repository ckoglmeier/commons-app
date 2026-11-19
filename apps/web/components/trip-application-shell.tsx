"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CommonsWordmark } from "@commons/ui";
import type { EventView } from "@/lib/commons-route";
import { AccountMenu } from "./account-menu";
import { EventNavigationLinks } from "./event-navigation";
import { PlusIcon, RouteIcon } from "./icons";

export type ShellAccount = {
  signedIn: boolean;
  actorName: string;
  actorInitials: string;
  /** "Organizer" | "Traveler" */
  roleLabel: string;
  signInHref: string;
  feedbackCommonsSlug: string;
};

const DESKTOP_QUERY = "(min-width: 1100px)";

/**
 * One persistent navigation hierarchy for the trip: a left rail from 1100px, and a compact header with a labeled Menu dialog below.
 * It owns the single main landmark. Destination links keep real hrefs; plain clicks use the in-app `navigate` transition.
 * Class names for page content: wrap Trip, Plan, Money and Photos content in `.trip-shell-page` (add `.trip-shell-page--document` for the narrower reading width).
 */
export function TripApplicationShell({ tripStage = null, commonsId, view, navigate, tripName, identity, account, busy = false, inert = false, contentLabel, children }: {
  tripStage?: "deciding" | "going" | null;
  commonsId: string;
  view: EventView;
  navigate: (view: EventView) => void;
  tripName: string;
  identity: (placement: "rail" | "menu", closeMenu: () => void) => ReactNode;
  account: ShellAccount;
  busy?: boolean;
  inert?: boolean;
  contentLabel?: string;
  children: ReactNode;
}) {
  const menuId = useId();
  const titleId = `${menuId}-title`;
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  // Looked up by id rather than the ref, so the callback can be handed to render-time slots.
  const closeMenu = useCallback(() => { const element = document.getElementById(menuId); if (element instanceof HTMLDialogElement && element.open) element.close(); }, [menuId]);

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const desktop = window.matchMedia(DESKTOP_QUERY);
    const closeOnDesktop = () => { if (desktop.matches) dialog.current?.close(); };
    const element = dialog.current;
    // Clicking the backdrop (outside the dialog box) closes the menu.
    const closeOnBackdrop = (event: MouseEvent) => {
      if (!element || event.target !== element) return;
      const rect = element.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) element.close();
    };
    desktop.addEventListener("change", closeOnDesktop);
    element?.addEventListener("click", closeOnBackdrop);
    return () => { document.body.style.overflow = previousOverflow; desktop.removeEventListener("change", closeOnDesktop); element?.removeEventListener("click", closeOnBackdrop); };
  }, [menuOpen]);

  // Any route change or a modal sheet opening elsewhere closes the menu.
  useEffect(() => { if (dialog.current?.open) dialog.current.close(); }, [pathname]);
  useEffect(() => { if (inert && dialog.current?.open) dialog.current.close(); }, [inert]);

  const guard = (event: React.MouseEvent) => { if (busy) event.preventDefault(); };
  const inertProps = inert ? { inert: true, "aria-hidden": true as const } : {};
  const newTrip = <Link className="trip-shell__trips" href="/new" aria-disabled={busy || undefined} onClick={guard}><PlusIcon /><span>Start a new trip</span></Link>;
  const yourTrips = <Link className="trip-shell__trips" href="/trips" aria-disabled={busy || undefined} onClick={guard}><RouteIcon /><span>Your trips</span></Link>;
  const brand = <Link className="trip-shell__brand" href="/" aria-label="Commons homepage" title="Commons homepage" aria-disabled={busy || undefined} onClick={guard}><CommonsWordmark /></Link>;

  return (
    <div className="trip-shell" data-busy={busy || undefined} data-inert={inert || undefined}>
      <a className="skip-link" href="#workspace-content">Skip to trip content</a>
      <header className="trip-shell__compact" {...inertProps}>
        {brand}
        <p className="trip-shell__compact-name">{tripName}</p>
        <button ref={trigger} type="button" className="trip-shell__menu-button" aria-haspopup="dialog" aria-expanded={menuOpen} aria-controls={menuId} disabled={busy} onClick={() => { dialog.current?.showModal(); setMenuOpen(true); }}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          <span>Menu</span>
        </button>
      </header>
      <aside className="trip-shell__rail" aria-label="Trip" {...inertProps}>
        <div className="trip-shell__rail-scroll">
          {brand}
          {identity("rail", closeMenu)}
          <nav className="trip-shell__nav" aria-label="Trip navigation">
            <EventNavigationLinks eventId={commonsId} view={view} navigate={navigate} busy={busy} tripStage={tripStage} />
          </nav>
        </div>
        <div className="trip-shell__foot">
          {newTrip}
          {yourTrips}
          {account.signedIn
            ? <AccountMenu variant="rail" showTrips={false} initials={account.actorInitials} label={account.actorName} roleLabel={account.roleLabel} canSignOut feedbackCommonsSlug={account.feedbackCommonsSlug} />
            : <Link className="trip-shell__sign-in" href={account.signInHref}>Sign in</Link>}
        </div>
      </aside>
      <dialog ref={dialog} id={menuId} className="trip-shell__menu" aria-labelledby={titleId} onClose={() => {
        setMenuOpen(false);
        // Return focus to the opener unless an action already moved focus elsewhere (for example into a sheet).
        const active = document.activeElement;
        if (trigger.current?.getClientRects().length && (!active || active === document.body || active === dialog.current)) trigger.current.focus();
      }}>
        <div className="trip-shell__menu-heading"><h2 id={titleId}>Menu</h2><button className="cm-action" type="button" onClick={closeMenu}>Close</button></div>
        <nav className="trip-shell__nav" aria-label="Trip menu navigation">
          <EventNavigationLinks eventId={commonsId} view={view} busy={busy} tripStage={tripStage} navigate={next => { closeMenu(); navigate(next); }} />
        </nav>
        {identity("menu", closeMenu)}
        <div className="trip-shell__menu-trips">{newTrip}{yourTrips}</div>
        <section className="trip-shell__menu-account" aria-label="Account">
          <h3>{account.signedIn ? account.actorName : "Account"}{account.signedIn ? <small>{account.roleLabel}</small> : null}</h3>
          {account.signedIn
            ? <AccountMenu inline showTrips={false} initials={account.actorInitials} label={account.actorName} canSignOut feedbackCommonsSlug={account.feedbackCommonsSlug} />
            : <nav aria-label="Account navigation"><Link href={account.signInHref}>Sign in</Link></nav>}
        </section>
      </dialog>
      <main id="workspace-content" className="trip-shell__content" tabIndex={-1} aria-label={contentLabel} aria-busy={busy || undefined} {...inertProps}>
        {children}
      </main>
    </div>
  );
}
