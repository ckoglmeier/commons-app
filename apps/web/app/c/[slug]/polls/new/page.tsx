import { notFound, redirect } from "next/navigation";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError, getCommonsDataMode, loadCommonsSnapshot } from "@/lib/server/commons";
import { PollStarter } from "./poll-starter";
import { loadAuthenticatedPoll, loadAuthenticatedPollDrafts } from "@/lib/server/polls";
import { PollWorkingDraftSchema } from "@commons/contracts";
import { stayComparison, stayPollDescription } from "@/lib/stay-compare";
import { readCommonsRuntimeEnvironment } from "@/lib/server/runtime-environment";
import { pollAssistanceEnabled } from "@/lib/server/poll-inference";
import { activityPollOptions } from "@/lib/activity-poll-options";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ask the group — Commons" };

export default async function NewPollPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ question?: string; stayIds?: string; transportIds?: string; activityIds?: string; template?: string; draft?: string; followUp?: string }> }) {
  const { slug } = await params;
  const { stayIds: rawStayIds, transportIds: rawTransportIds, activityIds: rawActivityIds, template, draft: draftId, followUp, question } = await searchParams;
  if (getCommonsDataMode(slug) !== "database") notFound();
  let snapshot: Awaited<ReturnType<typeof loadCommonsSnapshot>>;
  try {
    snapshot = await loadCommonsSnapshot(slug);
  } catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries({ stayIds: rawStayIds, transportIds: rawTransportIds, activityIds: rawActivityIds, template, draft: draftId, followUp })) if (typeof value === "string") query.set(key, value);
      redirect(`/sign-in?next=${encodeURIComponent(`/c/${slug}/polls/new${query.size ? `?${query}` : ""}`)}`);
    }
    if (error instanceof CommonsMembershipRequiredError) notFound();
    throw error;
  }
  if (!snapshot) notFound();
  const requestedStayIds = new Set((rawStayIds ?? "").split(",").filter(Boolean));
  const stayOptions = (snapshot.state.stays ?? [])
    .filter((stay) => requestedStayIds.has(stay.id) && stay.status === "considering")
    .map((stay, _index, chosen) => ({ id: stay.id, name: stay.name, address: stay.address, url: stay.bookingUrl ?? null, startsOn: stay.startsOn, endsOn: stay.endsOn,
      description: stayPollDescription(stay, stayComparison(chosen, snapshot.state.itinerary, snapshot.commons.timezone).get(stay.id)!) }));
  // Getting-around options. Prices and notes go to the group only when already shared with everyone.
  const requestedTransportIds = new Set((rawTransportIds ?? "").split(",").filter(Boolean));
  const transportOptions = (snapshot.state.travelPlans ?? [])
    .filter(plan => requestedTransportIds.has(plan.id) && (plan.kind === "transport" || plan.kind === "car_rental") && plan.visibility !== "private")
    .map(plan => ({ id: plan.id, name: (plan.provider ?? plan.vehicle ?? (plan.kind === "car_rental" ? "Rental car" : "Transport")).slice(0, 160),
      description: [plan.kind === "car_rental" ? "Rental car" : plan.vehicle, plan.route,
        plan.visibility === "all" && plan.totalCents ? new Intl.NumberFormat("en-US", { style: "currency", currency: plan.currency ?? "USD" }).format(plan.totalCents / 100) : null,
        plan.visibility === "all" ? plan.note || null : null].filter(Boolean).join(" · ").slice(0, 180) || null }));
  // Plan activities: shared (everyone), not cancelled, from this trip's own snapshot. Ids are kept as the option ids.
  const activityOptions = activityPollOptions(snapshot.state.itinerary ?? [], (rawActivityIds ?? "").split(",").filter(Boolean), snapshot.commons.timezone);
  if (draftId && !PollWorkingDraftSchema.shape.id.safeParse(draftId).success) notFound();
  const drafts = await loadAuthenticatedPollDrafts(slug, draftId);
  const draft = drafts.find(item => item.id === draftId);
  if (draftId && !draft) notFound();
  if (draft?.publishedPollId) redirect(`/c/${slug}/polls/${draft.publishedPollId}`);
  if (draft?.data.communication) redirect(`/c/${slug}/reviews/${draft.id}`);
  let sourcePoll;
  if (followUp && !draft) {
    if (!PollWorkingDraftSchema.shape.id.safeParse(followUp).success) notFound();
    try { sourcePoll = await loadAuthenticatedPoll(slug, followUp); } catch { notFound(); }
    if (!sourcePoll.currentActorCanManage) notFound();
  }
  const environment = readCommonsRuntimeEnvironment();
  const deciding = snapshot.commons.stage === "deciding";
  return <PollStarter linkOnly={deciding} bigQuestion={deciding && (question === "where" || question === "when" || question === "who") ? question : undefined} key={draftId ?? followUp ?? "new"} slug={slug} eventName={snapshot.commons.name} defaultCurrency={snapshot.commons.currency ?? "USD"} timezone={snapshot.commons.timezone} startsOn={snapshot.commons.startsOn} canSuggest={snapshot.currentActor.role === "organizer"} suggestionsAvailable={Boolean(pollAssistanceEnabled() && environment.OPENAI_API_KEY && environment.COMMONS_POLL_MODEL)} people={snapshot.participants.map(person => ({ id: person.id, name: person.displayName }))} sourcePoll={sourcePoll ? { id: sourcePoll.id, title: sourcePoll.title } : undefined} stayOptions={stayOptions} transportOptions={transportOptions} activityOptions={activityOptions} templateId={template} templateKey={snapshot.commons.templateKey ?? null} prefillTitle={deciding && question && question !== "where" && question !== "when" && question !== "who" ? question.slice(0, 120) : undefined} initialDraft={draft} savedDrafts={drafts} />;
}
