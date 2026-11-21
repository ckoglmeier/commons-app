import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { CommandAccessError, CommandConflictError, CommonsRepositoryError } from "@commons/database";
import { after, NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  CommonsAuthenticationRequiredError,
  CommonsMembershipRequiredError,
  getCommonsDataMode,
  loadCommonsMomentAsset,
  persistMomentDelete,
  persistMomentUpdate,
} from "@/lib/server/commons";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";
import { devSignInAvailable } from "@/lib/server/dev-session";
import { runCommonsMaintenance } from "@/lib/server/maintenance";

export const dynamic = "force-dynamic";

function response(body: BodyInit, mimeType: string) {
  return new Response(body, {
    headers: {
      "Cache-Control": "private, max-age=300",
      "Content-Type": mimeType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; momentId: string }> },
) {
  const { slug, momentId } = await params;
  try {
    const dataMode = getCommonsDataMode();
    // Local development with the local test sign-in keeps photos in a folder (see moments/local-upload).
    const localPhotos = dataMode === "database" && !isSupabaseAuthConfigured() && await devSignInAvailable();
    const supabase = dataMode === "database" && !localPhotos
      ? await createSupabaseServerClient()
      : null;
    const identity = supabase
      ? await supabase.auth.getClaims().then(({ data, error }) => {
          if (error || !data?.claims?.sub) {
            throw new CommonsAuthenticationRequiredError();
          }
          return {
            authUserId: data.claims.sub,
            email: typeof data.claims.email === "string" ? data.claims.email : undefined,
          };
        })
      : undefined;
    const asset = await loadCommonsMomentAsset(slug, momentId, identity);
    if (!asset) return new Response("Photo not found.", { status: 404 });

    if (localPhotos) {
      const localRoot = process.env.COMMONS_LOCAL_MOMENTS_DIR;
      if (!localRoot) return new Response("Photo media is not configured.", { status: 404 });
      const root = resolve(localRoot);
      const filePath = resolve(root, asset.storagePath);
      if (!filePath.startsWith(`${root}${sep}`)) {
        return new Response("Photo not found.", { status: 404 });
      }
      const bytes = await readFile(filePath);
      return response(new Uint8Array(bytes), asset.mimeType);
    }

    const { data, error } = await supabase!.storage
      .from("commons-moments")
      .download(asset.storagePath);
    if (error || !data) {
      console.error("Commons photo storage download failed.", {
        slug,
        momentId,
        storagePath: asset.storagePath,
        error,
      });
      return new Response("Photo not found.", { status: 404 });
    }
    return response(await data.arrayBuffer(), asset.mimeType);
  } catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) {
      return new Response("Sign in to view this photo.", { status: 401 });
    }
    if (error instanceof CommonsMembershipRequiredError) {
      return new Response("This photo belongs to another trip.", { status: 403 });
    }
    throw error;
  }
}

function jsonErrorResponse(error: unknown, action: "updated" | "deleted") {
  if (error instanceof CommandConflictError || error instanceof CommandAccessError) {
    return NextResponse.json({ error: error.message }, { status: error instanceof CommandConflictError ? 409 : 403 });
  }
  if (error instanceof CommonsAuthenticationRequiredError) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
  if (error instanceof CommonsMembershipRequiredError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: action === "updated" ? "Photo not updated. Check the caption and trip plan." : "Photo not deleted. Try again." },
      { status: 400 },
    );
  }
  if (error instanceof CommonsRepositoryError) {
    const status = error.code === "commons_not_found" || error.code === "moment_not_found" ? 404 : 403;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json(
    { error: `Photo not ${action}. Try again.` },
    { status: 503 },
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string; momentId: string }> },
) {
  try {
    const { slug, momentId } = await params;
    const snapshot = await persistMomentUpdate(slug, momentId, await request.json());
    return NextResponse.json({ snapshot });
  } catch (error) {
    return jsonErrorResponse(error, "updated");
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string; momentId: string }> },
) {
  try {
    const { slug, momentId } = await params;
    const snapshot = await persistMomentDelete(slug, momentId, await request.json());
    if (getCommonsDataMode() === "database") after(() => runCommonsMaintenance(5));
    return NextResponse.json({ snapshot });
  } catch (error) {
    return jsonErrorResponse(error, "deleted");
  }
}
