import type { Metadata } from "next";
import { CommonsMark, CommonsWordmark } from "@commons/ui";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { NewCommonsForm } from "@/app/new/new-commons-form";
import { commonsSetupPath } from "@/lib/commons-route";
import {
  CommonsAuthenticationRequiredError,
  CommonsMembershipRequiredError,
  loadAuthenticatedCommonsSetup,
} from "@/lib/server/commons";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Set up your trip — Commons",
};

export default async function CommonsSetupPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ step?: string }>;
}) {
  const { slug: identifier } = await params;
  const { step } = await searchParams;
  let setup: Awaited<ReturnType<typeof loadAuthenticatedCommonsSetup>>;
  try {
    setup = await loadAuthenticatedCommonsSetup(identifier);
  } catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) {
      redirect(`/sign-in?next=${encodeURIComponent(commonsSetupPath(identifier, step ?? "people"))}`);
    }
    if (error instanceof CommonsMembershipRequiredError) notFound();
    throw error;
  }
  if (identifier !== setup.commons.id) redirect(commonsSetupPath(setup.commons.id, step ?? "people"));

  return (
    <main className="creation-shell">
      <header className="creation-header">
        <Link className="entry-brand" href="/trips"><CommonsWordmark /></Link>
        <Link href="/trips">All trips</Link>
      </header>
      <div className="creation-layout creation-layout--setup">
        <aside className="creation-intro">
          <span className="view-kicker">Private draft</span>
          <h1>{setup.commons.name}</h1>
          <p>{tripSummary(setup.commons.startsOn, setup.commons.endsOn, setup.commons.locationName)}</p>
          <div className="creation-promise"><CommonsMark /><p><strong>Trip setup</strong><br />Invite people, then review before sending.</p></div>
        </aside>
        <NewCommonsForm
          initialSetup={setup}
          initialStep={step}
        />
      </div>
    </main>
  );
}

function tripSummary(startsOn: string | null, endsOn: string | null, locationName: string | null) {
  const dates = startsOn && endsOn ? `${startsOn}–${endsOn}` : "Dates to be decided";
  return locationName ? `${dates} · ${locationName}` : dates;
}
