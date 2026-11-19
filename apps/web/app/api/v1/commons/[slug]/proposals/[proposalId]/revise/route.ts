import { ZodError } from "zod";
import { CommonsRepositoryError } from "@commons/database";
import { DomainError } from "@commons/domain";
import { NextResponse } from "next/server";
import {
  CommonsAuthenticationRequiredError,
  CommonsMembershipRequiredError,
  persistProposalRevision,
} from "@/lib/server/commons";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string; proposalId: string }> },
) {
  try {
    const { slug, proposalId } = await params;
    const snapshot = await persistProposalRevision(slug, proposalId, await request.json());
    return NextResponse.json({ snapshot });
  } catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof CommonsMembershipRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof ZodError) {
      return NextResponse.json({ error: "Correction not saved. Check the details and try again." }, { status: 400 });
    }
    if (error instanceof DomainError || error instanceof CommonsRepositoryError) {
      return NextResponse.json({ error: error.message }, {
        status: error instanceof CommonsRepositoryError && error.code === "commons_not_found" ? 404 : 409,
      });
    }
    return NextResponse.json({ error: "Correction not saved. Try again." }, { status: 503 });
  }
}
