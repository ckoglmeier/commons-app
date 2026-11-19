import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { authorizeCoordinatorSource, saveCoordinatorSource, readCoordinatorSources, removeCoordinatorSource, CommandAccessError, CommandConflictError } from "@commons/database";
import { authenticatedGoalOptions } from "@/lib/server/polls";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError } from "@/lib/server/commons-access-errors";
import { readCommonsRuntimeEnvironment } from "@/lib/server/runtime-environment";
import { extractCoordinatorSource, SourceReadError, SOURCE_FILE_BYTES } from "@/lib/import/coordinator-source";
import { agentCapabilityBlock } from "@/lib/server/trip-capabilities";
export const runtime = "nodejs", maxDuration = 15;
const headers = { "Cache-Control": "private, no-store" };
function failure(error: unknown) {
  const status = error instanceof CommonsAuthenticationRequiredError ? 401 : error instanceof CommandAccessError || error instanceof CommonsMembershipRequiredError ? 403 : error instanceof CommandConflictError ? 409 : error instanceof SourceReadError || error instanceof ZodError ? 400 : 503;
  return NextResponse.json({ error: error instanceof SourceReadError ? error.message : status === 401 ? "Sign in again to attach or read this source. Your message is unchanged." : status === 403 ? "That source is not available to you in this conversation." : status === 409 ? "Source limits or versions changed. Remove unused attachments or upload a smaller file." : "The source could not be loaded. Your message is unchanged; try again." }, { status, headers });
}
function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  // Next may use its internal bind hostname in request.url. Compare the actual
  // request host (and proxy protocol) so same-origin browser uploads still work.
  const external = new URL(request.url), host = request.headers.get("host"), protocol = request.headers.get("x-forwarded-proto");
  if (host) external.host = host;
  if (protocol === "https" || protocol === "http") external.protocol = protocol + ":";
  if (origin && origin !== external.origin) throw new CommandAccessError();
}
async function boundedForm(request: Request) {
  const limit = SOURCE_FILE_BYTES + 10000;
  if (Number(request.headers.get("content-length") ?? 0) > limit || !request.body) throw new SourceReadError("Choose a file up to 1 MB.");
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void reader.cancel(); }, 5000);
  try { while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > limit) { await reader.cancel(); throw new SourceReadError("Choose a file up to 1 MB."); } chunks.push(value); } }
  finally { clearTimeout(timer); reader.releaseLock(); }
  if (timedOut) throw new SourceReadError("The upload took too long. Your message is unchanged; try attaching the file again.");
  return new Response(Buffer.concat(chunks), { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData();
}
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) { const capabilityBlock = await agentCapabilityBlock((await params).slug); if (capabilityBlock) return capabilityBlock;
  try {
    sameOrigin(request);
    const slug = (await params).slug, options = await authenticatedGoalOptions(slug);
    // Authenticate/authorize before consuming or parsing a potentially expensive upload.
    const destination = new URL(request.url).searchParams.get("scope") ?? "";
    await authorizeCoordinatorSource(slug, destination, options);
    if (readCommonsRuntimeEnvironment().COMMONS_ASSISTANT_UI_ENABLED !== "true") throw new SourceReadError("File attachments are not enabled here. Your message is unchanged.");
    const form = await boundedForm(request), file = form.get("file");
    if (!(file instanceof File)) throw new SourceReadError("Choose a Markdown, text or .xlsx file.");
    const id = z.string().uuid().parse(form.get("id"));
    if (file.name.length > 160) throw new SourceReadError("Use a filename under 160 characters.");
    const extracted = await extractCoordinatorSource(file);
    const row = await saveCoordinatorSource(slug, { id, scope: destination, filename: file.name, ...extracted }, options);
    return NextResponse.json({ source: { id: row.id, digest: row.digest, filename: row.filename, text: row.extractedText, limitations: row.limitations, expiresAt: row.expiresAt.toISOString() } }, { headers });
  } catch (error) { return failure(error); }
}
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const url = new URL(request.url), slug = (await params).slug;
    const refs = [{ id: z.string().uuid().parse(url.searchParams.get("id")), digest: z.string().length(64).parse(url.searchParams.get("digest")) }];
    const destination = url.searchParams.get("scope") ?? "";
    await authorizeCoordinatorSource(slug, destination, await authenticatedGoalOptions(slug));
    const [row] = await readCoordinatorSources(slug, refs, await authenticatedGoalOptions(slug), undefined, destination);
    return NextResponse.json({ source: { id: row.id, digest: row.digest, filename: row.filename, text: row.extractedText, limitations: row.limitations, expiresAt: row.expiresAt.toISOString() } }, { headers });
  } catch (error) { return failure(error); }
}
export async function DELETE(request: Request, { params }: { params: Promise<{ slug: string }> }) { const capabilityBlock = await agentCapabilityBlock((await params).slug); if (capabilityBlock) return capabilityBlock;
  try { sameOrigin(request); const slug = (await params).slug; await removeCoordinatorSource(slug, new URL(request.url).searchParams.get("id") ?? "", await authenticatedGoalOptions(slug)); return NextResponse.json({ removed: true }, { headers }); }
  catch (error) { return failure(error); }
}
