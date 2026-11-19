import { CommonsWordmark } from "@commons/ui";
import Link from "next/link";
import { CoverSketch } from "@/components/cover-sketch";
import { ResilientCoverImage } from "@/components/resilient-cover-image";
import { notFound, redirect } from "next/navigation";
import { getCurrentCommonsIdentity, loadInvitationPreview } from "@/lib/server/commons";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";
import { getInvitationEntryContext, invitationProofMatches, readInvitationEmailProof } from "@commons/database";
import { commonsDatabaseUrl, textMessagingAvailable, webMessagesEnabledFor } from "@/lib/server/runtime-environment";
import { getSupabaseAuthUserEmail } from "@/lib/supabase/admin";
import { invitationReturnPath, maskedInvitationEmail } from "@/lib/invitation-entry-flow";
import { commonsWorkspacePath } from "@/lib/commons-route";
import { InvitationEntryForm } from "./invitation-entry-form";
import { SignInForm } from "@/app/sign-in/sign-in-form";
import { DemoInviteRedeemForm, JoinAction } from "./join-action";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" as const };

function displayDates(startsOn: string | null, endsOn: string | null) {
  if (!startsOn && !endsOn) return "Dates to be decided";
  if (startsOn && !endsOn) {
    return `Starts ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${startsOn}T12:00:00Z`))}`;
  }
  if (!startsOn && endsOn) {
    return `Ends ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${endsOn}T12:00:00Z`))}`;
  }
  const start = new Date(`${startsOn}T12:00:00Z`);
  const end = new Date(`${endsOn}T12:00:00Z`);
  const sameMonth =
    start.getUTCFullYear() === end.getUTCFullYear() &&
    start.getUTCMonth() === end.getUTCMonth();
  if (sameMonth) {
    const monthDay = new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    }).format(start);
    return `${monthDay}–${end.getUTCDate()}, ${end.getUTCFullYear()}`;
  }
  const format = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${format.format(start)}–${format.format(end)}`;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export default async function JoinCommonsPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ poll?: string; entry?: string }>;
}) {
  const { token } = await params;
  const query = await searchParams;
  const requestedPoll = query.poll;
  const pollPublicId = requestedPoll && /^[0-9a-f]{12}$/.test(requestedPoll) ? requestedPoll : undefined;
  const demo = token.startsWith("demo-invitation-");
  const preview = demo
    ? {
        commonsName: "Cape Cod Couples Week",
        startsOn: "2027-07-18",
        endsOn: "2027-07-25",
        locationName: "Falmouth, Massachusetts",
        coverImageUrl: "/moments/cape-beach.jpg",
        inviterName: "Jordan",
        recipientName: "Maya",
        status: "pending" as const,
        managedTraveler: false,
      }
    : await loadInvitationPreview(token);
  if (!preview) notFound();
  const identity = await getCurrentCommonsIdentity();
  const dbUrl = commonsDatabaseUrl();
  const entryContext = !demo && dbUrl ? await getInvitationEntryContext(token, dbUrl) : null;
  if (entryContext && identity && entryContext.acceptedAuthUserId === identity.authUserId) {
    redirect(pollPublicId ? `/c/poll/${pollPublicId}` : commonsWorkspacePath(entryContext.commonsId));
  }
  const proof = query.entry ? readInvitationEmailProof(query.entry, token) : null;
  const freshEntry = proof && entryContext && invitationProofMatches(proof, entryContext) ? query.entry : undefined;
  const recipientEmail = entryContext?.acceptedAuthUserId
    ? await getSupabaseAuthUserEmail(entryContext.acceptedAuthUserId)
    : entryContext?.recipientEmail;
  const emailLabel = recipientEmail ? maskedInvitationEmail(recipientEmail) : "your invited email";
  const sameAccount = identity && (proof && freshEntry ? proof.authUserId === identity.authUserId
    : recipientEmail?.toLowerCase() === identity.email?.toLowerCase());
  const next = invitationReturnPath(token, pollPublicId);

  if (preview.status === "pending" || entryContext?.status === "accepted") {
    const welcomeName = identity?.displayName?.trim() || preview.recipientName.split(/\s+/)[0];
    return (
      <main className="invite-arrival invite-arrival--email-entry">
        <div className="invite-arrival__media" aria-hidden="true">
          <CoverSketch context={{ name: preview.commonsName, locationName: preview.locationName }} />
          <ResilientCoverImage src={preview.coverImageUrl} alt="" sizes="100vw" />
          <span />
        </div>
        <Link className="invite-arrival__brand" href="/"><CommonsWordmark /></Link>
        <section className="invite-arrival__trip" aria-labelledby="invite-arrival-title">
          <span>Invited by {preview.inviterName}</span>
          <h1 id="invite-arrival-title">{preview.commonsName}</h1>
          <p>{displayDates(preview.startsOn, preview.endsOn)}{preview.locationName ? ` · ${preview.locationName}` : ""}</p>
        </section>
        <footer className="invite-arrival__footer">
          {identity && sameAccount && preview.status === "pending" ? <>
            <div>{preview.managedTraveler ? <p>Accept to manage your own profile and take part directly. Your trip history stays with you, and your organizer’s access to your private profile ends.</p> : null}<span>Welcome, {welcomeName}</span><strong>{pollPublicId ? "Join to help shape this event." : "Your place in the trip is ready."}</strong>{pollPublicId ? <p>Joining gives you event access. It does not confirm you’re attending.</p> : null}</div>
            <div className="invite-arrival__actions">
              <JoinAction token={token} signedIn demo={demo} label={preview.managedTraveler ? "Accept invitation" : pollPublicId ? "Help shape this trip" : "View the trip"} pollPublicId={pollPublicId} textMessagingOffered={textMessagingAvailable() || webMessagesEnabledFor(identity.email)} className="invite-arrival__primary" />
            </div>
          </> : demo ? <div className="invite-arrival__redeem">
            <div><span>This invitation is for {preview.recipientName}</span><strong>Redeem it to enter the trip.</strong></div>
            <DemoInviteRedeemForm />
          </div> : <div className="invite-arrival__redeem">
            <div><span>{preview.status === "accepted" ? "Welcome back" : `Invited: ${preview.recipientName}`}</span><strong>{emailLabel}</strong>
              {query.entry && !freshEntry ? <p>The sign-in link expired or was already used. Your invitation is still here.</p> : null}
            </div>
            {entryContext ? <InvitationEntryForm token={token} entry={freshEntry} poll={pollPublicId} emailLabel={emailLabel}
              currentAccountId={identity?.authUserId} currentEmail={identity ? identity.email ?? identity.displayName ?? "your current account" : undefined} next={next} enabled={isSupabaseAuthConfigured()} />
              : <SignInForm next={next} enabled={isSupabaseAuthConfigured()} intent="invited" />}
            {identity && preview.status === "pending" && !preview.managedTraveler ? <div className="invite-arrival__actions">
              <JoinAction token={token} signedIn demo={false} label={`Join as ${identity.email ?? identity.displayName ?? "your current account"}`} pollPublicId={pollPublicId} textMessagingOffered={textMessagingAvailable() || webMessagesEnabledFor(identity.email)} className="invite-arrival__secondary" />
            </div> : null}
          </div>}
        </footer>
      </main>
    );
  }

  return (
    <main className="entry-shell join-shell">
      <section className="entry-card join-card">
        <Link className="entry-brand" href="/">
          <CommonsWordmark />
        </Link>
        <div className="join-invitation">
          <span className="view-kicker">{demo ? `[DEMO] Invited by ${preview.inviterName}` : `Invited by ${preview.inviterName}`}</span>
          <h1>{demo ? `[DEMO] ${preview.commonsName}` : preview.commonsName}</h1>
          <p>{displayDates(preview.startsOn, preview.endsOn)}{preview.locationName ? ` · ${preview.locationName}` : ""}</p>
        </div>
        <div className="join-person">
          <span>{initials(preview.recipientName)}</span>
          <p><strong>This invitation is for {preview.recipientName}.</strong><br />Join to see the trip and take part.</p>
        </div>
        <div className="entry-preview-note"><strong>Invitation {preview.status}</strong><p>Ask the organizer for a new link.</p></div>
        <p className="entry-footnote">
          Joining adds your name and trip activity to the group. Commons does not access your calendar.
        </p>
      </section>
    </main>
  );
}
