import { NextResponse } from "next/server";
import { runDailyAnalyticsReport } from "@/lib/server/daily-analytics";
import { authorizeCommonsCronRequest } from "@/lib/server/runtime-environment";

export const maxDuration = 60;

export async function GET(request: Request) {
  const authorization = authorizeCommonsCronRequest(request);
  if (!authorization.authorized) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  try {
    return NextResponse.json(await runDailyAnalyticsReport());
  } catch {
    // Never expose operational credentials, emails, or provider errors through a cron response.
    return NextResponse.json({ error: "Daily analytics report could not be queued." }, { status: 503 });
  }
}
