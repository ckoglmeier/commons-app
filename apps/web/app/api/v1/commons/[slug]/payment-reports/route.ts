import { betaErrorResponse, loadPaymentReports, reportPayment } from "@/lib/server/beta-completion";

type Context = { params: Promise<{ slug: string }> };

/** Payment reports ("I paid"). 404 unless the beta rework is on. A report never changes a balance. */
export async function GET(_request: Request, { params }: Context) {
  try {
    return Response.json({ reports: await loadPaymentReports((await params).slug) });
  } catch (error) {
    return betaErrorResponse(error) ?? Response.json({ error: "Payment reports are unavailable. Try again." }, { status: 503 });
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    return Response.json({ report: await reportPayment((await params).slug, await request.json()) }, { status: 201 });
  } catch (error) {
    return betaErrorResponse(error) ?? Response.json({ error: "Report not saved. Your details are still here. Try again." }, { status: 503 });
  }
}
