import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError, loadCommonsCoverAsset } from "@/lib/server/commons";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createStoredCoverCard } from "@/lib/server/cover-card";
import { storeCommonsPhotoAsset } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function coverResponse(body: ArrayBuffer | Uint8Array, mimeType: string, immutable: boolean) {
  const responseBody = body instanceof ArrayBuffer
    ? body
    : body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
  return new Response(responseBody, { headers: {
    "Cache-Control": immutable ? "private, max-age=31536000, immutable" : "private, max-age=300",
    "Content-Type": mimeType,
    "X-Content-Type-Options": "nosniff",
  } });
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const variant = new URL(request.url).searchParams.get("variant") === "card" ? "card" : "original";
  try {
    const supabase = await createSupabaseServerClient();
    const identity = await supabase.auth.getClaims().then(({ data, error }) => {
      if (error || !data?.claims?.sub) throw new CommonsAuthenticationRequiredError();
      return { authUserId: data.claims.sub, email: typeof data.claims.email === "string" ? data.claims.email : undefined };
    });
    const asset = await loadCommonsCoverAsset(slug, variant, identity);
    if (!asset) return new Response("Cover not found.", { status: 404 });
    const { data, error } = await supabase.storage.from("commons-moments").download(asset.storagePath);
    if (!error && data) return coverResponse(await data.arrayBuffer(), asset.mimeType, variant === "card");
    if (!asset.fallbackStoragePath || variant !== "card") return new Response("Cover not found.", { status: 404 });
    const fallback = await supabase.storage.from("commons-moments").download(asset.fallbackStoragePath);
    if (fallback.error || !fallback.data) return new Response("Cover not found.", { status: 404 });
    const card = await createStoredCoverCard(await fallback.data.arrayBuffer());
    try {
      await storeCommonsPhotoAsset(asset.storagePath, card, "image/webp");
    } catch (cacheError) {
      console.error("Commons cover card cache failed", { slug, storagePath: asset.storagePath, cacheError });
    }
    return coverResponse(card, "image/webp", true);
  } catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) return new Response("Sign in to view this cover.", { status: 401 });
    if (error instanceof CommonsMembershipRequiredError) return new Response("This cover belongs to another trip.", { status: 403 });
    throw error;
  }
}
