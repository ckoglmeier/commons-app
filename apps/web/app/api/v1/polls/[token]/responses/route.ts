import { PollRepositoryError } from "@commons/database";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { normalizePollPublicId } from "@/lib/poll-route";
import { savePublicPollResponse, savePublicPollResponseByPublicId } from "@/lib/server/polls";
import { readBoundedJson } from "@/lib/bounded-json";
import { recordOutcome, recordOperationFailure } from "@/lib/server/outcome-telemetry";
import { createHash } from "node:crypto";

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const input = await readBoundedJson(request, 128_000);
    const publicId = normalizePollPublicId(token);
    const { telemetryTripId, telemetryPollId, ...saved } = publicId
      ? await savePublicPollResponseByPublicId(publicId, input)
      : await savePublicPollResponse(token, input);
    // Count the first saved response once per poll and respondent: signed-in by account, guests by their receipt.
    if (!saved.revised && telemetryPollId) recordOutcome({ event: "poll_response_saved", key: `${telemetryPollId}:${createHash("sha256").update(saved.receiptToken).digest("hex")}`, trip: telemetryTripId, request });
    return NextResponse.json(saved);
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({error:"Check the response size and format."},{status:400});
    if (error instanceof ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "Check your answers." }, { status: 400 });
    if (error instanceof PollRepositoryError) {
      const status = error.code === "poll_not_found" ? 404 : error.code === "poll_closed" ? 409 : 400;
      return NextResponse.json({ error: error.message, savedResponse: error.savedResponse }, { status });
    }
    recordOperationFailure({ operation: "poll_response", error, request });
    return NextResponse.json({ error: "Response not saved. Try again." }, { status: 503 });
  }
}
