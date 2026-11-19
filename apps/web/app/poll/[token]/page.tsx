import { notFound, redirect } from "next/navigation";
import { authenticatedPollViewer, loadPublicPoll } from "@/lib/server/polls";
import { publicPollPath } from "@/lib/poll-route";

export const dynamic = "force-dynamic";

export default async function PublicPollPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const poll = await loadPublicPoll(token);
  if (!poll) {
    if (!await authenticatedPollViewer()) redirect(`/sign-in?next=${encodeURIComponent(`/poll/${token}`)}`);
    notFound();
  }
  redirect(publicPollPath(poll.publicId));
}
