import { NextResponse } from "next/server";
import { pingDatabase } from "@commons/database";
import { betaReworkEnabled } from "@/lib/beta/flags";
import { commonsDatabaseUrl } from "@/lib/server/runtime-environment";

/** For an outside uptime monitor. It says up or down and nothing else. */
export async function GET() {
  if (!betaReworkEnabled()) return new NextResponse(null, { status: 404 });
  const url = commonsDatabaseUrl();
  const headers = { "Cache-Control": "no-store" };
  try {
    if (!url) throw new Error("unconfigured");
    await pingDatabase(url);
    return NextResponse.json({ ok: true }, { headers });
  } catch { return NextResponse.json({ ok: false }, { status: 503, headers }); }
}
