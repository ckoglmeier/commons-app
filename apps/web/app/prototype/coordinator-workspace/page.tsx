import { notFound } from "next/navigation";
import { CoordinatorThreadSchema } from "@commons/contracts";
import { CoordinatorWorkspace } from "@/components/coordinator-workspace";
import { WorkspaceFocusPrototype } from "@/components/workspace-focus-prototype";

export default async function WorkspaceReview({ searchParams }: { searchParams: Promise<{ ask?: string; published?: string; voice?: string }> }) {
  const { ask, published, voice } = await searchParams;
  if (process.env.NODE_ENV !== "development") notFound();
  if (!ask && !published) return <WorkspaceFocusPrototype />;
  const id = (last: number) => `70000000-0000-4000-8000-${String(last).padStart(12, "0")}`;
  const at = "2026-09-17T12:00:00.000Z";
  const data = { title: "Where should we stay?", intro: "A base for our weekend.", ballotMode: "transparent", communication: { heading: "Let’s choose our base", paragraphs: ["Here are two possibilities. Nothing is held or booked."], links: [] }, questions: [{ id: id(5), kind: "choice", prompt: "Which place works for you?", selectionMode: "multiple", options: [{ id: id(6), label: "A small hotel in town" }, { id: id(7), label: "A house outside town" }] }] };
  const publishedPollId = published === "1" ? id(10) : null;
  const goalId = id(20);
  const thread = CoordinatorThreadSchema.parse({ version: 2, activeThreadId: goalId, threads: [{ id: goalId, title: "Choose our home base", status: "active", version: 1, createdByPersonId: id(21), createdByName: "Alex", turnCount: 2, draftCount: 1, pollCount: publishedPollId ? 1 : 0, archivedAt: null, createdAt: at, updatedAt: at }], hasEarlier: false, polls: [{ id: id(1), publicId: "abcdef123456", title: "Which weekend works?", status: "closed", createdAt: at, audienceRestricted: false, responseCount: 6, resultsVisible: true, results: [{ questionId: id(2), prompt: "Choose a weekend", textResponseCount: 0, options: [{ optionId: id(3), label: "November 5–7", count: 6 }] }] }, ...(publishedPollId ? [{ id: publishedPollId, threadId: goalId, publicId: "deadbeef1234", title: data.title, status: "open", createdAt: at, audienceRestricted: true, responseCount: 0, resultsVisible: false, results: [] }] : [])], drafts: [{ id: id(4), threadId: goalId, version: 1, data, createdAt: at, updatedAt: at, publishedPollId }], turns: [
    { id: id(8), threadId: goalId, sequence: 1, userText: "Would another hotel option help?", assistantText: "Only if it offers a real alternative. A walkable, smaller hotel could be worth comparing with the house. We still need confirmed rates and cancellation terms.", draftId: id(4), createdAt: at, workspace: { saved: true } },
    { id: id(9), threadId: goalId, sequence: 2, userText: "Make the introduction a little warmer.", assistantText: "Here’s a shorter introduction for your review. Nothing has changed in the saved draft yet.", draftId: id(4), createdAt: at, workspace: { proposal: { baseVersion: 1, data: { ...data, intro: "Let’s find a place that works for everyone." }, changes: ["poll introduction"], state: "pending" } } },
  ] });
  return <CoordinatorWorkspace key={`${ask ?? "review"}:${published ?? "draft"}`} startQuestion={ask === "1"} slug="local-workspace-review" eventName="Wine country weekend · Synthetic review" initialThread={thread} initialRecommendations={[]} tripIdeas={[{ id: id(30), title: "Private cooking class", status: "idea", provenanceLabel: "Suggested by Alex", sourceUrl: "https://example.com/cooking" }, { id: id(31), title: "Fly-fishing lesson", status: "idea", provenanceLabel: "Suggested by Sam" }]} conversationAvailable={voice === "1"} voiceAvailable={voice === "1"} prototypeInspector />;
}
