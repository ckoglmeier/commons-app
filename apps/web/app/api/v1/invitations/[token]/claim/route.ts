import { OnboardingRepositoryError } from "@commons/database";
import { NextResponse } from "next/server";
import {
  claimAuthenticatedInvitation,
  CommonsAuthenticationRequiredError,
  loadCommonsSnapshot,
} from "@/lib/server/commons";
import { recordBetaAttribution } from "@/lib/server/beta-completion";
import { recordOutcome, recordOperationFailure } from "@/lib/server/outcome-telemetry";
import { createHash } from "node:crypto";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    const slug = await claimAuthenticatedInvitation(token);
    recordOutcome({ event: "invitation_accepted", key: createHash("sha256").update(token).digest("hex"), perActor: true, trip: slug, request });
    const snapshot = await loadCommonsSnapshot(slug);
    if (!snapshot) return NextResponse.json({ error: "Invitation event not found." }, { status: 404 });
    await recordBetaAttribution("traveler_participation", { entryKind: "unknown" }, snapshot.commons.id);
    return NextResponse.json({ commonsId: snapshot.commons.id, slug });
  } catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    recordOperationFailure({ operation: "invitation_accept", error, request });
    if (error instanceof OnboardingRepositoryError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json(
      { error: "Invitation not accepted. Try again." },
      { status: 503 },
    );
  }
}
