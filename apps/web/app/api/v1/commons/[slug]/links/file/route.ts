import { NextResponse } from "next/server";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError, loadCommonsSnapshot } from "@/lib/server/commons";
import { UploadTooLargeError, readBoundedFormData } from "@/lib/import/read-bounded-form-data";
import { identifyConfirmationFile } from "@/lib/import/confirmation-file";
import { readUploadedFile } from "@/lib/import/read-uploaded-file";
import { fileTitle, placeHintsFromText } from "@/lib/place-file";

export const runtime = "nodejs";

/** Reads a PDF or image someone chose for a new idea and suggests a name and
 * link. The file is read in this request only; Commons does not keep it. */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    if (!await loadCommonsSnapshot(slug)) return NextResponse.json({ error: "Trip not found." }, { status: 404 });
    const file = (await readBoundedFormData(request)).get("file");
    if (!(file instanceof File) || !file.size) return NextResponse.json({ error: "Choose a PDF or image." }, { status: 400 });
    let identified: Awaited<ReturnType<typeof identifyConfirmationFile>>;
    try { identified = await identifyConfirmationFile(file); } catch { return NextResponse.json({ error: "Choose a PDF, PNG, JPEG or WebP file under 10 MB." }, { status: 400 }); }
    if (identified.mimeType.startsWith("image/")) {
      return NextResponse.json({ hints: { title: fileTitle(file.name), url: null, readable: false } }, { headers: { "Cache-Control": "private, no-store" } });
    }
    if (identified.mimeType !== "application/pdf") return NextResponse.json({ error: "Choose a PDF or image." }, { status: 400 });
    const source = await readUploadedFile(new File([identified.bytes], "idea.pdf", { type: "application/pdf" }));
    return NextResponse.json({ hints: placeHintsFromText(source.text.slice(0, 20_000), file.name) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
    if (error instanceof CommonsMembershipRequiredError) return NextResponse.json({ error: error.message }, { status: 403 });
    if (error instanceof UploadTooLargeError) return NextResponse.json({ error: error.message }, { status: 413 });
    return NextResponse.json({ error: "That file couldn’t be read. Add the name instead." }, { status: 400 });
  }
}
