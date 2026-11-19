import { NextResponse } from "next/server";
import { runTrafficWatch } from "@/lib/server/traffic-watch";
import { authorizeCommonsCronRequest } from "@/lib/server/runtime-environment";

/** For a scheduler. Counts only: no trip, person or answer data leaves here. */
export async function GET(request: Request) {
  const authorization = authorizeCommonsCronRequest(request);
  if (!authorization.authorized) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  try { return NextResponse.json(await runTrafficWatch()); }
  catch { return NextResponse.json({ error: "Traffic check could not run." }, { status: 503 }); }
}
