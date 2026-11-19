import { CommonsRepositoryError } from "@commons/database";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  CommonsAuthenticationRequiredError,
  CommonsMembershipRequiredError,
  loadCommonsCoverAsset,
  persistCoverUpdate,
} from "@/lib/server/commons";
import { removeCommonsPhotoAssets } from "@/lib/supabase/admin";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const input = await request.json();
    const [previousOriginal, previousCard] = await Promise.all([
      loadCommonsCoverAsset(slug, "original"),
      loadCommonsCoverAsset(slug, "card"),
    ]);
    const snapshot = await persistCoverUpdate(slug, input);
    const nextPaths = new Set([input?.originalStoragePath, input?.cardStoragePath]);
    const replacedPaths = [previousOriginal?.storagePath, previousCard?.storagePath]
      .filter((path): path is string => Boolean(path) && !nextPaths.has(path));
    if (replacedPaths.length) {
      try {
        await removeCommonsPhotoAssets(replacedPaths);
      } catch (cleanupError) {
        console.error("Commons replaced cover cleanup failed", { slug, cleanupError });
      }
    }
    return NextResponse.json({ snapshot });
  } catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof CommonsMembershipRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof ZodError) {
      return NextResponse.json({ error: "Cover not updated. Choose a trip photo." }, { status: 400 });
    }
    if (error instanceof CommonsRepositoryError) {
      const status = error.code === "commons_not_found" || error.code === "moment_not_found" ? 404 : 403;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ error: "Cover not updated. Try again." }, { status: 503 });
  }
}
