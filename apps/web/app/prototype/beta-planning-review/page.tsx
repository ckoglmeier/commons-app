import { notFound } from "next/navigation";
import type { PollDetail } from "@commons/contracts";
import { PollDecisionActions } from "@/components/poll-decision-actions";
import { ProfileNotifications } from "@/components/profile-notifications";

// Local-only QA specimen of production components; never grants auth or writes fixtures.
export default function BetaPlanningReview() {
  if (process.env.NODE_ENV !== "development") notFound();
  const poll = { id: "00000000-0000-4000-8000-000000000003", currentActorRole: "organizer",
    decision: { id: "00000000-0000-4000-8000-000000000004", summary: "Local sample", approvedByName: "Sample organizer",
      approvedAt: "2026-09-13T12:00:00Z", target: "record", planId: null } } as PollDetail;
  return <main className="profile-shell"><h1>Planning controls · Local QA</h1><p>Sample data. Email preference requests must be mocked by the test harness.</p>
    <section className="poll-responses"><h2>What was decided</h2><PollDecisionActions slug="10000000-0000-4000-8000-000000000001" poll={poll} /></section>
    <ProfileNotifications initialDailyDigestEnabled initialEvents={[
      { eventId: "00000000-0000-4000-8000-000000000001", name: "September mountain weekend with the whole group", enabled: true },
      { eventId: "00000000-0000-4000-8000-000000000002", name: "Neighborhood dinner", enabled: true },
    ]} />
  </main>;
}
