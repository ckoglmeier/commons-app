import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PollWorkspaceHeader } from "@/components/poll-workspace-header";
import { RecipeTransport } from "@/components/recipe-transport";
import { CommonsAuthenticationRequiredError, getCommonsDataMode } from "@/lib/server/commons";
import { RecipesDisabledError, loadAuthenticatedTransportReview } from "@/lib/server/recipes";
import { heldFeaturePath, tripCapabilitiesFor } from "@/lib/server/trip-capabilities";

export const dynamic = "force-dynamic";
export const metadata = { title: "Suggested rides" };

export default async function TransportPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ window?: string }> }) {
  const { slug } = await params, { window: raw } = await searchParams;
  const capabilities = await tripCapabilitiesFor(slug);
  if (!capabilities.goals) redirect(heldFeaturePath(slug));
  if (getCommonsDataMode(slug) !== "database") notFound();
  const minutes = Number(raw), windowMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : undefined;
  let review: Awaited<ReturnType<typeof loadAuthenticatedTransportReview>>;
  try { review = await loadAuthenticatedTransportReview(slug, windowMinutes); }
  catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) redirect(`/sign-in?next=${encodeURIComponent(`/c/${slug}/recipes/transport`)}`);
    if (error instanceof RecipesDisabledError) notFound();
    notFound();
  }
  return <main className="poll-organizer-shell"><PollWorkspaceHeader eventName={review.tripName} eventHref={`/c/${slug}`} eventLabel="Trip Home" askHref={`/c/${slug}/ask`} askLabel="Ask the group" pollsHref={`/c/${slug}/polls`} {...(capabilities.tier === "beta" ? { goalsHref: `/c/${slug}/goals` } : {})} />
    <div className="poll-organizer-content recipe-content"><nav aria-label="Ask the group navigation" className="recipe-back"><Link href={`/c/${slug}/ask`}>← Ask the group</Link></nav><RecipeTransport slug={slug} review={review} /></div></main>;
}
