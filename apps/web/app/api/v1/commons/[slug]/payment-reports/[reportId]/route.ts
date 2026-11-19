import { betaErrorResponse, resolvePaymentReport } from "@/lib/server/beta-completion";

/** Records the receipt for a report (the person paid, or an organizer) or dismisses it. Only a recorded receipt can settle anything. */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string; reportId: string }> }) {
  try {
    const { slug, reportId } = await params;
    return Response.json(await resolvePaymentReport(slug, reportId, await request.json()));
  } catch (error) {
    return betaErrorResponse(error) ?? Response.json({ error: "Payment not recorded. Try again." }, { status: 503 });
  }
}
