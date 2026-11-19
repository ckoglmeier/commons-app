import { getPublicPollCoverAssetByPublicId } from "@commons/database";
import { downloadCommonsPhotoAsset } from "@/lib/supabase/admin";
import { commonsDatabaseUrl } from "@/lib/server/runtime-environment";
import { authenticatedPollViewer } from "@/lib/server/polls";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const databaseUrl = commonsDatabaseUrl();
  if (!databaseUrl) return new Response("Cover not found.", { status: 404 });
  const asset = await getPublicPollCoverAssetByPublicId(token, databaseUrl, await authenticatedPollViewer());
  if (!asset) return new Response("Cover not found.", { status: 404 });
  const file = await downloadCommonsPhotoAsset(asset.storagePath);
  if (!file) return new Response("Cover not found.", { status: 404 });
  return new Response(await file.arrayBuffer(), { headers: {
    "Cache-Control": "private, no-store",
    "Content-Type": asset.mimeType,
    "X-Content-Type-Options": "nosniff",
  } });
}
