import { betaErrorResponse, createSuccessorDraft, eventCreationErrorResponse, loadSuccessorChoices } from "@/lib/server/beta-completion";

type Context = { params: Promise<{ slug: string }> };

/** What a successor draft may reuse from this trip: titles of shared ideas and stay options, and the destination. */
export async function GET(_request: Request, { params }: Context) {
  try {
    return Response.json({ source: await loadSuccessorChoices((await params).slug) });
  } catch (error) {
    return betaErrorResponse(error) ?? Response.json({ error: "Couldn't load this trip's ideas. Try again." }, { status: 503 });
  }
}

/** Creates a private successor draft through the existing creation path. It sends no invitation and takes no payment. */
export async function POST(request: Request, { params }: Context) {
  try {
    return Response.json(await createSuccessorDraft((await params).slug, await request.json()), { status: 201 });
  } catch (error) {
    const known = betaErrorResponse(error);
    if (known) return known;
    // Creation access, limits and conflicts use the same responses as /new.
    return eventCreationErrorResponse(error);
  }
}
