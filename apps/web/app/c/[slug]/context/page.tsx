import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CommonsWordmark } from "@commons/ui";
import { CommandAccessError, CoordinatorTurnError } from "@commons/database";
import { authenticatedTripPlanningContext } from "@/lib/server/polls";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError } from "@/lib/server/commons";
import { TripContextEditor } from "@/components/trip-context-editor";
import "@/components/trip-context-editor.css";
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let context;
  try { context = await authenticatedTripPlanningContext(slug); }
  catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) redirect(`/sign-in?next=${encodeURIComponent(`/c/${slug}/context/`)}`);
    if (error instanceof CommonsMembershipRequiredError || error instanceof CommandAccessError || error instanceof CoordinatorTurnError) notFound();
    throw error;
  }
  return <main className="trip-context-page"><nav aria-label="Trip context navigation"><Link href="/trips"><CommonsWordmark /></Link><Link href={`/c/${context.tripId}/?arrival=0&view=home`}>Back to trip</Link></nav><header><span>{context.name} · Organizers only</span><h1>Trip context</h1><p>Commons uses this for planning and research. You can change it any time.</p></header><TripContextEditor initial={context} /></main>;
}
