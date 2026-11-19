import {
  CommonsAuthenticationRequiredError,
  CommonsMembershipRequiredError,
  loadCommonsConfirmationAsset,
} from "@/lib/server/commons";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { downloadCommonsConfirmationAsset } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; resourceType: string; resourceId: string }> }) {
  const { slug, resourceType, resourceId } = await params;
  if (resourceType !== "stay" && resourceType !== "travel" && resourceType !== "expense") return new Response("Confirmation not found.", { status: 404 });
  try {
    const supabase = await createSupabaseServerClient();
    const identity = await supabase.auth.getClaims().then(({ data, error }) => {
      if (error || !data?.claims?.sub) throw new CommonsAuthenticationRequiredError();
      return { authUserId: data.claims.sub, email: typeof data.claims.email === "string" ? data.claims.email : undefined };
    });
    const asset = await loadCommonsConfirmationAsset(slug, resourceType, resourceId, identity);
    if (!asset) return new Response("Confirmation not found.", { status: 404 });
    const data = await downloadCommonsConfirmationAsset(asset.storagePath);
    if (!data) return new Response("Confirmation not found.", { status: 404 });
    return new Response(await data.arrayBuffer(), { headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": asset.mimeType,
      "Content-Disposition": `inline; filename="${asset.fileName.replace(/["\\\r\n]/g, "_")}"`,
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) return new Response("Sign in to view this confirmation.", { status: 401 });
    if (error instanceof CommonsMembershipRequiredError) return new Response("This confirmation belongs to another trip.", { status: 403 });
    throw error;
  }
}
