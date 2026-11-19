import { TrackProductAnalyticsEventRequestSchema } from "@commons/contracts";
import { createProductAnalyticsEvent } from "@commons/database";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getCommonsAuthIdentity } from "@/lib/supabase/server";
import { commonsDatabaseUrl } from "@/lib/server/runtime-environment";
import { redactInvitationPath } from "@/lib/analytics-invitation-privacy";
import { browserEventAllowed, sanitizedEventProperties } from "@/lib/analytics-event-policy";

import { analyticsOriginAllowed } from "@/lib/analytics-origin";

const maximumRequestBytes = 12_000;

function sanitizedPagePath(pagePath: string) {
  return redactInvitationPath(pagePath);
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!analyticsOriginAllowed(origin, request.url, process.env.NEXT_PUBLIC_SITE_URL)) {
    return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > maximumRequestBytes) {
    return NextResponse.json({ error: "Analytics event is too large." }, { status: 413 });
  }

  try {
    const input = TrackProductAnalyticsEventRequestSchema.parse(await request.json());
    if (!browserEventAllowed(input)) return NextResponse.json({ error: "Invalid analytics event." }, { status: 400 });
    const databaseUrl = commonsDatabaseUrl();
    if (!databaseUrl) return NextResponse.json({ received: false }, { status: 202 });

    const identity = await getCommonsAuthIdentity().catch(() => null);
    const created = await createProductAnalyticsEvent({
      ...input,
      pagePath: sanitizedPagePath(input.pagePath),
      properties: sanitizedEventProperties(input.properties),
      authUserId: identity?.authUserId,
      userAgent: request.headers.get("user-agent") ?? undefined,
      country: request.headers.get("x-vercel-ip-country") ?? undefined,
      region: request.headers.get("x-vercel-ip-country-region") ?? undefined,
      city: request.headers.get("x-vercel-ip-city") ?? undefined,
    }, databaseUrl);
    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: "Invalid analytics event." }, { status: 400 });
    }
    console.error("Product analytics event failed.", error);
    return NextResponse.json({ error: "Analytics event not saved." }, { status: 503 });
  }
}
