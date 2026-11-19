import { NextResponse } from "next/server";
import {
  CommonsAuthenticationRequiredError,
  CommonsMembershipRequiredError,
  getCommonsDataMode,
  loadCommonsSnapshot,
} from "@/lib/server/commons";
import { createCommonsPhotoUploadToken } from "@/lib/supabase/admin";

const supportedTypes = new Map([["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"]]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const input = await request.json();
    const id = typeof input?.id === "string" ? input.id : "";
    const mimeType = typeof input?.mimeType === "string" ? input.mimeType : "";
    const extension = supportedTypes.get(mimeType);
    if (!uuidPattern.test(id) || !extension) return NextResponse.json({ error: "Choose a JPG, PNG, or WebP cover photo." }, { status: 400 });
    if (getCommonsDataMode(slug) !== "database") return NextResponse.json({ error: "Demo covers stay on this device." }, { status: 403 });
    const snapshot = await loadCommonsSnapshot(slug);
    if (!snapshot) return NextResponse.json({ error: "Trip not found." }, { status: 404 });
    const originalStoragePath = `${slug}/covers/${id}/original.${extension}`;
    const cardStoragePath = `${slug}/covers/${id}/card.webp`;
    const [originalToken, cardToken] = await Promise.all([
      createCommonsPhotoUploadToken(originalStoragePath),
      createCommonsPhotoUploadToken(cardStoragePath),
    ]);
    return NextResponse.json({
      original: { storagePath: originalStoragePath, token: originalToken },
      card: { storagePath: cardStoragePath, token: cardToken },
    });
  } catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) return NextResponse.json({ error: "Your sign-in expired. Refresh and try again." }, { status: 401 });
    if (error instanceof CommonsMembershipRequiredError) return NextResponse.json({ error: "You don’t have permission to change this trip cover." }, { status: 403 });
    console.error("Commons cover upload slot failed", error);
    return NextResponse.json({ error: "Cover upload is temporarily unavailable. Try again shortly." }, { status: 503 });
  }
}
