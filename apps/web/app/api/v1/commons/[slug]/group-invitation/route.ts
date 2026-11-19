import { NextResponse } from "next/server";
import { getGroupInvitation, manageGroupInvitation } from "@commons/database";
import { ManageGroupInvitationSchema } from "@commons/contracts";
import { groupInvitationManagementOptions } from "@/lib/server/group-invitations";
import { groupInvitationBody, groupInvitationFailure, groupInvitationHeaders } from "@/lib/server/group-invitation-http";
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const options = await groupInvitationManagementOptions(slug, "read");
    if (!options) return NextResponse.json({ enabled: false }, { headers: groupInvitationHeaders });
    return NextResponse.json({ enabled: true, invitation: await getGroupInvitation(slug, options) }, { headers: groupInvitationHeaders });
  } catch (error) { return groupInvitationFailure(error); }
}
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params, input = ManageGroupInvitationSchema.parse(await groupInvitationBody(request));
    const options = await groupInvitationManagementOptions(slug);
    if (!options) return NextResponse.json({ error: "Group invitations aren’t available for this account and trip." }, { status: 404, headers: groupInvitationHeaders });
    return NextResponse.json({ enabled: true, invitation: await manageGroupInvitation(slug, input, options) }, { headers: groupInvitationHeaders });
  } catch (error) { return groupInvitationFailure(error); }
}
