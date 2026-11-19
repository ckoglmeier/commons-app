import type { Metadata } from "next";
import { loadCommonsSnapshot } from "@/lib/server/commons";
import { GirlsTripPollPrototype } from "./girls-trip-poll-prototype";

const GIRLS_TRIP_ID = "6b043aa5-4c4d-4515-a884-e3d1c9fa9968";

export const metadata: Metadata = {
  title: "Early poll invitation prototype — Commons",
  description: "A reusable early-trip poll with invitations, conversation todo, preferences, and organizer results.",
  robots: { index: false, follow: false },
};

export default async function GirlsTripPollInvitePrototypePage() {
  let coverImageUrl: string | null = null;
  try {
    const snapshot = await loadCommonsSnapshot(GIRLS_TRIP_ID);
    coverImageUrl = snapshot?.commons.coverImageUrl ?? null;
  } catch {
    // The prototype remains reviewable without database access. Production uses the member-authorized trip cover.
  }
  return <GirlsTripPollPrototype coverImageUrl={coverImageUrl} />;
}
