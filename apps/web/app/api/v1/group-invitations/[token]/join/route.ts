import { NextResponse } from "next/server";
import { JoinGroupInvitationSchema } from "@commons/contracts";
import { joinAuthenticatedGroupInvitation } from "@/lib/server/group-invitations";
import { groupInvitationBody, groupInvitationFailure, groupInvitationHeaders } from "@/lib/server/group-invitation-http";
import { recordOutcome, recordOperationFailure } from "@/lib/server/outcome-telemetry";
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params, input = JoinGroupInvitationSchema.parse(await groupInvitationBody(request));
    const result = await joinAuthenticatedGroupInvitation(token, input);
    recordOutcome({ event: "group_joined", key: result.tripId, perActor: true, trip: result.tripId, request });
    return NextResponse.json({ ...result, destination: `/c/${result.tripId}/` }, { headers: groupInvitationHeaders });
  } catch (error) { recordOperationFailure({ operation: "group_join", error, request }); return groupInvitationFailure(error); }
}
