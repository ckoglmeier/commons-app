import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { NextResponse } from "next/server";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError, loadCommonsSnapshot } from "@/lib/server/commons";
import { devSignInAvailable } from "@/lib/server/dev-session";

export const dynamic = "force-dynamic";

const types = new Map([["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"]]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Local development only: stores a photo in COMMONS_LOCAL_MOMENTS_DIR when there's no Supabase Storage, so photos can be tried with the
 * local test sign-in. Not found everywhere else, including every production build.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const root = process.env.COMMONS_LOCAL_MOMENTS_DIR;
  if (process.env.NODE_ENV !== "development" || !root || !(await devSignInAvailable())) return new Response("Not found.", { status: 404 });
  try {
    const { slug } = await params;
    const url = new URL(request.url);
    const id = url.searchParams.get("id") ?? "", extension = types.get(request.headers.get("content-type") ?? "");
    if (!uuid.test(id) || !extension) return NextResponse.json({ error: "Choose a JPG, PNG, or WebP photo." }, { status: 400 });
    if (!await loadCommonsSnapshot(slug)) return NextResponse.json({ error: "Trip not found." }, { status: 404 });
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!bytes.length || bytes.length > 25 * 1024 * 1024) return NextResponse.json({ error: "Choose a smaller photo." }, { status: 400 });
    const storagePath = `${slug}/${id}.${extension}`;
    const base = resolve(root), file = resolve(base, storagePath);
    if (!file.startsWith(`${base}${sep}`)) return new Response("Not found.", { status: 404 });
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes, { flag: "wx" });
    return NextResponse.json({ storagePath });
  } catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) return NextResponse.json({ error: "Your sign-in expired. Refresh and try again." }, { status: 401 });
    if (error instanceof CommonsMembershipRequiredError) return NextResponse.json({ error: "You don’t have permission to add photos to this trip." }, { status: 403 });
    throw error;
  }
}
