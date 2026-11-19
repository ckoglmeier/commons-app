import { CommonsRepositoryError } from "@commons/database";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  CommonsAuthenticationRequiredError,
  CommonsMembershipRequiredError,
  persistMomentCreate,
} from "@/lib/server/commons";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const supportedTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  let uploadedPath: string | null = null;
  try {
    const { slug } = await params;
    const input = await request.json();
    const id = typeof input?.id === "string" ? input.id : "";
    const mimeType = typeof input?.mimeType === "string" ? input.mimeType : "";
    const extension = supportedTypes.get(mimeType);
    const storagePath = typeof input?.storagePath === "string" ? input.storagePath : "";
    if (!id || !extension || storagePath !== `${slug}/${id}.${extension}`) {
      return NextResponse.json(
        { error: "Photo not added. Check the file and try again." },
        { status: 400 },
      );
    }
    uploadedPath = storagePath;
    const snapshot = await persistMomentCreate(slug, input);
    return NextResponse.json({ snapshot, momentId: id }, { status: 201 });
  } catch (error) {
    if (uploadedPath) {
      const supabase = await createSupabaseServerClient();
      await supabase.storage.from("commons-moments").remove([uploadedPath]);
    }
    if (error instanceof CommonsAuthenticationRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof CommonsMembershipRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof ZodError) {
      return NextResponse.json({ error: "Photo not added. Check the caption and trip plan." }, { status: 400 });
    }
    if (error instanceof CommonsRepositoryError) {
      const status = error.code === "commons_not_found" || error.code === "itinerary_not_found" ? 404 : 403;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ error: "Photo not added. Try again." }, { status: 503 });
  }
}
