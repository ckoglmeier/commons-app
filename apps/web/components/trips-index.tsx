import { CoverSketch } from "./cover-sketch";
import type { CommonsMembershipSummary } from "@commons/contracts";
import { CommonsMark, CommonsWordmark } from "@commons/ui";
import Link from "next/link";
import Image from "next/image";
import { commonsSetupPath, commonsWorkspacePath } from "@/lib/commons-route";
import { groupTripMemberships } from "@/lib/trip-memberships";
import { PlusIcon } from "./icons";
import { AccountMenu } from "./account-menu";
import { ResilientCoverImage } from "./resilient-cover-image";
import { JoinAction } from "@/app/join/[token]/join-action";
import type { PendingCommonsInvitationSummary } from "@commons/database";
import { tripCardCoverUrl } from "@/lib/trip-card-cover";

function formatTripDates(startsOn: string | null, endsOn: string | null) {
  if (!startsOn && !endsOn) return "Dates to be decided";
  if (startsOn && !endsOn) {
    return `Starts ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${startsOn}T12:00:00`))}`;
  }
  if (!startsOn && endsOn) {
    return `Ends ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${endsOn}T12:00:00`))}`;
  }
  const start = new Date(`${startsOn}T12:00:00`);
  const end = new Date(`${endsOn}T12:00:00`);
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();
  const month = (value: Date) => new Intl.DateTimeFormat("en-US", {
    month: "short",
  }).format(value);
  if (sameMonth) {
    return `${month(start)} ${start.getDate()}–${end.getDate()}, ${end.getFullYear()}`;
  }
  if (sameYear) {
    return `${month(start)} ${start.getDate()}–${month(end)} ${end.getDate()}, ${end.getFullYear()}`;
  }
  return `${month(start)} ${start.getDate()}, ${start.getFullYear()}–${month(end)} ${end.getDate()}, ${end.getFullYear()}`;
}

function tripPhase(trip: CommonsMembershipSummary) {
  if (trip.commons.slug === "cape-cod-couples-week") return "[DEMO]";
  if (trip.commons.setupCompletedAt === null) return "Private draft";
  if (trip.commons.status === "active") return "Happening now";
  if (trip.commons.status === "closing" || trip.commons.status === "archived") {
    return "Past trip";
  }
  return "Planning";
}

function TripArtwork({ trip, priority = false }: {
  trip: CommonsMembershipSummary;
  priority?: boolean;
}) {
  return (
    <span className="trip-index-art" aria-hidden="true">
      <CoverSketch context={trip.commons} />
      <ResilientCoverImage
        src={tripCardCoverUrl(trip.commons)}
        alt=""
        priority={priority}
        sizes="(max-width: 767px) 100vw, 36rem"
      />
    </span>
  );
}

function TripCard({ trip, priority = false, showRole = true, openLabel = "Open" }: {
  trip: CommonsMembershipSummary;
  priority?: boolean;
  showRole?: boolean;
  openLabel?: string;
}) {
  const href = trip.commons.setupCompletedAt === null
    ? commonsSetupPath(trip.commons.id)
    : commonsWorkspacePath(trip.commons.id);
  return (
    <Link className="trip-index-card" href={href} data-analytics-event={trip.commons.slug === "cape-cod-couples-week" ? "demo_opened" : "trip_opened"} data-analytics-commons={trip.commons.slug} data-analytics-detail="trip_card">
      <TripArtwork trip={trip} priority={priority} />
      <span className="trip-index-card__copy">
        <span className={`trip-index-phase${trip.commons.slug === "cape-cod-couples-week" ? " trip-index-phase--demo" : ""}`}>{tripPhase(trip)}</span>
        <strong>{trip.commons.name}</strong>
        <small>
          {formatTripDates(trip.commons.startsOn, trip.commons.endsOn)}
          {trip.commons.locationName ? ` · ${trip.commons.locationName}` : ""}
        </small>
        <span className="trip-index-people">
          {trip.participantCount} {trip.participantCount === 1 ? "traveler" : "travelers"}
          {showRole && trip.role === "organizer" ? " · Organizer" : ""}
        </span>
      </span>
      <span className="trip-index-open">{openLabel} <span aria-hidden="true">→</span></span>
    </Link>
  );
}

export function TripsIndex({
  memberships,
  pendingInvitations = [],
  canSignOut,
  accountInitials,
  signedIn,
  creationAccessAllowed = false,
  creationAccessStatus = null,
  publicPage = false,
  operator = false,
  publicFreeBeta = false,
  organizesTrips = true,
  supportInFooter = false,
}: {
  memberships: CommonsMembershipSummary[];
  pendingInvitations?: PendingCommonsInvitationSummary[];
  canSignOut: boolean;
  accountInitials: string;
  signedIn: boolean;
  creationAccessAllowed?: boolean;
  creationAccessStatus?: string | null;
  publicPage?: boolean;
  operator?: boolean;
  /** COMMONS_PUBLIC_FREE_BETA_ENABLED: self-service "Start a trip" replaces the request-access path. */
  publicFreeBeta?: boolean;
  /** False for a signed-in person who is not an organizer of any trip: offers a quiet path to their own trip. */
  organizesTrips?: boolean;
  /** True when the homepage footer is shown: Support and your data lives there, so the main area leaves it out. */
  supportInFooter?: boolean;
}) {
  if (publicPage || !signedIn) {
    const betaRequestPath = "/new?access=request";
    const betaAccessHref = signedIn
      ? betaRequestPath
      : `/sign-in?next=${encodeURIComponent(betaRequestPath)}&intent=access`;
    const accessPending = creationAccessStatus === "requested";
    const creationHref = creationAccessAllowed ? "/new" : betaAccessHref;
    const creationLabel = creationAccessAllowed
      ? "Start a trip"
      : accessPending
        ? "View request"
        : "Request access";
    return (
      <main className="trips-shell public-trips-shell">
        <header className="global-nav global-nav--index">
          <Link className="brand-lockup homepage-brand" href="/" aria-label="Commons homepage" aria-describedby="homepage-beta-status">
            <CommonsWordmark />
            <span className="homepage-brand__beta" id="homepage-beta-status">Beta</span>
          </Link>
          <div className="workspace-actions public-header-actions">
            {signedIn ? (
              <>
                <AccountMenu initials={accountInitials} canSignOut={canSignOut} operator={operator} />
              </>
            ) : (
              <>
                <Link href="/sign-in?next=%2Ftrips&intent=invited" data-analytics-event="sign_in_started" data-analytics-detail="header">Sign in</Link>
              </>
            )}
          </div>
        </header>

        <div className="homepage-scene">
        <div className="public-trips-content" id="homepage-content">
          <section className="public-trips-hero">
            <h1><span>Group travel</span>{" "}<span>with less group work.</span></h1>
            <div className="public-trips-pitch"><p>{publicFreeBeta
              ? "Plan trips, ask the group, decide together, keep the plan current, and track shared expenses."
              : "Plan trips, make decisions, track shared expenses, and keep the memories."}</p></div>
          </section>
          {publicFreeBeta && !signedIn ? (
            <div className="homepage-invitation">
              <Link className="homepage-primary" href="/sign-in?next=%2Fnew&intent=create" data-analytics-event="event_creation_viewed" data-analytics-detail="homepage_start_trip">Start a trip</Link>
              <p>Free to start. Begin with a title; add dates, places and people when you’re ready.</p>
            </div>
          ) : (
            <div className="homepage-invitation">
              <Link className="homepage-primary" href={signedIn ? "/trips" : "/sign-in?next=%2Ftrips&intent=invited"} data-analytics-event={signedIn ? undefined : "sign_in_started"} data-analytics-detail="invited_router">{signedIn ? "Open your trips" : "Sign in to your trip"}</Link>
              {signedIn ? null : <p>Use the email your invitation was sent to.</p>}
            </div>
          )}
          {publicFreeBeta ? (
            <section className="homepage-beta" aria-label={signedIn ? "Start a trip" : "Invited to a trip"}>
              {signedIn
                ? <p>Planning a trip? <Link href="/new" data-analytics-event="event_creation_viewed" data-analytics-detail="homepage_beta">Start a trip</Link></p>
                : <p>Invited to a trip? <Link href="/sign-in?next=%2Ftrips&intent=invited" data-analytics-event="sign_in_started" data-analytics-detail="invited_router">Sign in to your trip</Link> with the email your invitation was sent to.</p>}
            </section>
          ) : (
          <section className="homepage-beta" aria-label="Beta access">
            <p>{creationAccessAllowed ? "Planning a trip?" : accessPending ? "Access requested." : "Planning a trip?"}{" "}<Link href={creationHref} data-analytics-event={creationAccessAllowed ? "event_creation_viewed" : "beta_access_started"} data-analytics-detail="homepage_beta">{creationLabel}</Link></p>
          </section>
          )}
          {supportInFooter ? null : <p className="homepage-support"><Link href="/support">Support and your data</Link></p>}
        </div>
        <div className="homepage-coast" aria-hidden="true"><Image src="/brand/coast.webp" alt="" fill sizes="100vw" priority /></div>
        </div>
      </main>
    );
  }

  const { currentTrips, pastTrips, archivedTrips } = groupTripMemberships(memberships);
  const allTripsClosed = memberships.length > 0 && currentTrips.length === 0;
  const creationIsPrimary = !memberships.length || allTripsClosed;

  return (
    <main className="trips-shell">
      <header className="global-nav global-nav--index">
        <Link className="brand-lockup" href="/" aria-label="Commons homepage">
          <CommonsWordmark />
        </Link>
        <div className="workspace-actions trips-header__actions">
          {creationAccessAllowed && !creationIsPrimary ? <Link className="new-trip-link" href="/new"><PlusIcon /> {publicFreeBeta ? "New trip" : "New trip"}</Link> : null}
          <AccountMenu initials={accountInitials} canSignOut={canSignOut} operator={operator} />
        </div>
      </header>

      <div className="trips-content">
        <section className={`trips-intro${allTripsClosed ? " trips-intro--closed" : ""}`}>
          {allTripsClosed ? <span className="view-kicker">Your trips</span> : null}
          <h1>{allTripsClosed ? "Where to next?" : "Your trips"}</h1>
          {allTripsClosed && creationAccessAllowed ? <Link className="trips-intro__action" href="/new"><PlusIcon /> New trip</Link> : null}
        </section>

        {!memberships.length && !pendingInvitations.length ? (
          <section className="trips-empty">
            <span><CommonsMark /></span>
            <h2>No trips yet.</h2>
            <p>Start a trip or open an invitation.</p>
            {creationAccessAllowed ? <Link className="form-submit" href="/new"><PlusIcon /> {publicFreeBeta ? "Start a trip" : "Start a trip"}</Link> : null}
          </section>
        ) : null}

        {publicFreeBeta && creationAccessAllowed && !organizesTrips && memberships.length ? (
          <p className="trips-own-trip"><Link href="/new" data-analytics-event="participant_trip_start_clicked" data-analytics-detail="trips_index">Plan your own trip</Link></p>
        ) : null}

        {pendingInvitations.length ? (
          <section className="trips-group trips-invitations" aria-labelledby="pending-invitations-title">
            <div className="trips-group__heading">
              <h2 id="pending-invitations-title">Invitations</h2>
              <span>{pendingInvitations.length}</span>
            </div>
            <div className="trip-invitation-list">
              {pendingInvitations.map((invitation) => (
                <article className="trip-invitation-row" key={invitation.token}>
                  <div>
                    <span className="trip-invitation-row__status">Invited by {invitation.inviterName}</span>
                    <h3>{invitation.commons.name}</h3>
                    <p>{formatTripDates(invitation.commons.startsOn, invitation.commons.endsOn)}{invitation.commons.locationName ? ` · ${invitation.commons.locationName}` : ""}</p>
                  </div>
                  <JoinAction token={invitation.token} signedIn demo={false} label="Accept invitation" className="trip-invitation-accept" />
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {currentTrips.length ? (
          <section className="trips-group" aria-labelledby="current-trips-title">
            <div className="trips-group__heading">
              <h2 id="current-trips-title">Coming up</h2>
              <span>{currentTrips.length}</span>
            </div>
            <div className="trips-grid">
              {currentTrips.map((trip, index) => (
                <TripCard key={trip.commons.id} trip={trip} priority={index === 0} />
              ))}
            </div>
          </section>
        ) : null}

        {pastTrips.length ? (
          <section className="trips-group trips-group--past" aria-labelledby="past-trips-title">
            <div className="trips-group__heading">
              <h2 id="past-trips-title">Past trips</h2>
              <span>{pastTrips.length}</span>
            </div>
            <div className="trips-grid trips-grid--past">
              {pastTrips.map((trip) => <TripCard key={trip.commons.id} trip={trip} />)}
            </div>
          </section>
        ) : null}

        {archivedTrips.length ? (
          <details className="trips-archived">
            <summary>
              <span>Archived</span>
              <small>{archivedTrips.length}</small>
            </summary>
            <div className="trips-grid trips-grid--past">
              {archivedTrips.map((trip) => (
                <TripCard key={trip.commons.id} trip={trip} />
              ))}
            </div>
          </details>
        ) : null}
        <p className="trips-support"><Link href="/support">Support and your data</Link></p>
      </div>
    </main>
  );
}
