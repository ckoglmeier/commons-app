import { LinkPreviewSchema } from "@commons/contracts";
import { NextResponse } from "next/server";
import { z } from "zod";
import { previewExternalLink, LinkPreviewError } from "@/lib/link-preview";
import {
  CommonsAuthenticationRequiredError,
  CommonsMembershipRequiredError,
  loadCommonsSnapshot,
} from "@/lib/server/commons";

export const runtime = "nodejs";

const RequestSchema = z.object({ url: z.string().trim().min(1).max(2_048) });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const snapshot = await loadCommonsSnapshot(slug);
    if (!snapshot) return NextResponse.json({ error: "Trip not found." }, { status: 404 });
    const { url } = RequestSchema.parse(await request.json());
    const preview = await previewExternalLink(url);
    const existingItem = snapshot.state.itinerary.find((item) => item.sourceUrl === preview.url);
    return NextResponse.json({
      preview: LinkPreviewSchema.parse({
        ...preview,
        existingItem: existingItem ? {
          id: existingItem.id,
          title: existingItem.title,
          status: existingItem.status,
        } : undefined,
      }),
    });
  } catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof CommonsMembershipRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof LinkPreviewError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Paste a complete web link." }, { status: 400 });
    }
    return NextResponse.json({ error: "That link could not be previewed. Try again." }, { status: 503 });
  }
}
