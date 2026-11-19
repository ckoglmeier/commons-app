import { notFound, redirect } from "next/navigation";
import { PollWorkingDraftSchema } from "@commons/contracts";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError, loadCommonsSnapshot } from "@/lib/server/commons";
import { loadAuthenticatedPollDrafts } from "@/lib/server/polls";

export const dynamic = "force-dynamic";
export default async function ReviewPage({ params }: { params: Promise<{ slug: string; draftId: string }> }) {
  const { slug, draftId } = await params;
  if (!PollWorkingDraftSchema.shape.id.safeParse(draftId).success) notFound();
  let draft, snapshot;
  try {
    snapshot = await loadCommonsSnapshot(slug);
    [draft] = await loadAuthenticatedPollDrafts(slug, draftId);
  } catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) redirect(`/sign-in?next=${encodeURIComponent(`/c/${slug}/reviews/${draftId}`)}`);
    if (error instanceof CommonsMembershipRequiredError) notFound();
    throw error;
  }
  if (!draft?.data.communication || !snapshot || snapshot.currentActor.role !== "organizer") notFound();
  redirect(`/c/${slug}/coordinator?draft=${draft.id}`);
}
