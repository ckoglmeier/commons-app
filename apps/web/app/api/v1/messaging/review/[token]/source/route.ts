import { addReviewSource } from "@/lib/server/messaging/web";
import { json, messagingRoute, notFound } from "@/lib/server/messaging/http";
import { readBoundedFormData, UploadTooLargeError } from "@/lib/import/read-bounded-form-data";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ token: string }> };

/** Add booking details to this review: pasted text (JSON) or a PDF/picture (multipart). Always starts a new version for the person to review. */
export const POST = (request: Request, { params }: Context) => messagingRoute(async () => {
  const { token } = await params;
  let source: Parameters<typeof addReviewSource>[1];
  if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    let form: FormData;
    try { form = await readBoundedFormData(request); } catch (error) { if (error instanceof UploadTooLargeError) return json({ error: { code: "too_large", message: error.message } }, 413); throw error; }
    const file = form.get("file");
    if (!(file instanceof File)) return json({ error: { code: "invalid", message: "Choose a file." } }, 400);
    source = { bytes: new Uint8Array(await file.arrayBuffer()), mimeType: file.type, fileName: file.name.slice(0, 120) || "booking" };
  } else {
    const body = await request.json() as { text?: unknown };
    if (typeof body.text !== "string" || body.text.trim().length < 10) return json({ error: { code: "invalid", message: "Paste the booking details." } }, 400);
    source = { text: body.text };
  }
  const outcome = await addReviewSource(token, source);
  return outcome ? json({ outcome: outcome.kind, reason: outcome.kind === "unreadable" ? outcome.reason : undefined, question: outcome.kind === "needs_info" ? outcome.question : undefined }) : notFound();
});
