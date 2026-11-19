import { betaErrorResponse, loadRecap, writeRecap } from "@/lib/server/beta-completion";

type Context = { params: Promise<{ slug: string }> };

/** The trip recap. Organizers see and edit the draft; travelers see it only once an organizer has shared it. */
export async function GET(_request: Request, { params }: Context) {
  try {
    return Response.json({ recap: await loadRecap((await params).slug) });
  } catch (error) {
    return betaErrorResponse(error) ?? Response.json({ error: "The recap is unavailable. Try again." }, { status: 503 });
  }
}

export async function PUT(request: Request, { params }: Context) {
  try {
    return Response.json({ recap: await writeRecap((await params).slug, await request.json()) });
  } catch (error) {
    return betaErrorResponse(error) ?? Response.json({ error: "Recap not saved. Your text is still here. Try again." }, { status: 503 });
  }
}
