import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { updateSupabaseSession } from "@/lib/supabase/proxy";
import { canonicalProductionUrl } from "@/lib/supabase/session";

const INTERNAL_CRON_PATHS = new Set([
  "/api/internal/invitation-deliveries/",
]);

export function shouldPreserveVercelCronHost(pathname: string, authorization: string | null) {
  return INTERNAL_CRON_PATHS.has(pathname) && authorization?.startsWith("Bearer ") === true;
}

export async function proxy(request: NextRequest) {
  const preserveCronHost = shouldPreserveVercelCronHost(
    request.nextUrl.pathname,
    request.headers.get("authorization"),
  );
  const canonical = preserveCronHost ? null : canonicalProductionUrl(request.nextUrl);
  if (canonical) return NextResponse.redirect(canonical, 308);
  return updateSupabaseSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|icon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
