import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { CommandAccessError, CommandConflictError, PollInferenceLimitError } from "@commons/database";
import { PollCommunicationSchema, PollWorkingDataSchema } from "@commons/contracts";
import { readBoundedJson } from "@/lib/bounded-json";
import { reviewChanges, reviewCheckpoint } from "@/lib/coordinator-review";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError } from "@/lib/server/commons";
import { loadAuthenticatedDraftRecipients, loadAuthenticatedPollDrafts, saveAuthenticatedPollDraft, reopenAuthenticatedCoordinatorDraft, saveAuthenticatedPublishedDeliveryNote } from "@/lib/server/polls";

export const maxDuration = 60;
const Input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reopen"), version: z.number().int().positive() }),
  z.object({ action: z.literal("save"), version: z.number().int().positive(), data: PollWorkingDataSchema }),
  z.object({ action: z.literal("save-message"), version: z.number().int().positive(), communication: PollCommunicationSchema.nullable() }),
  z.object({ action: z.literal("undo"), version: z.number().int().positive() }),
  z.object({ action: z.literal("recipients"), version: z.number().int().positive() }),
]);
const headers = { "Cache-Control": "private, no-store" };
export async function POST(request: Request, { params }: { params: Promise<{ slug: string; draftId: string }> }) {
  try {
    const { slug, draftId } = await params;
    z.string().uuid().parse(draftId);
    const input = Input.parse(await readBoundedJson(request, 100_000));
    if (input.action === "reopen") return NextResponse.json({ draft: await reopenAuthenticatedCoordinatorDraft(slug, draftId, input.version) }, { headers });
    if (input.action === "save-message") return NextResponse.json({ draft: await saveAuthenticatedPublishedDeliveryNote(slug, draftId, input.version, input.communication) }, { headers });
    const [draft] = await loadAuthenticatedPollDrafts(slug, draftId);
    if (!draft) throw new CommandAccessError();
    if (draft.version !== input.version || draft.publishedPollId) throw new CommandConflictError();
    if (input.action === "recipients") return NextResponse.json(await loadAuthenticatedDraftRecipients(slug, draftId, input.version), { headers });
    let data = draft.data;
    if (input.action === "undo") {
      if (!data.review?.previous) return NextResponse.json({ error: "There is no edit to undo." }, { status: 400, headers });
      data = { ...data, ...data.review.previous, review: { ...data.review, previous: null, lastChange: "Undid the last content edit. Recipients are unchanged." } };
    } else {
      const changes = reviewChanges(data, input.data);
      data = { ...input.data, review: { messages: data.review?.messages ?? [], previous: reviewCheckpoint(data), lastChange: changes.length ? `You updated ${changes.join(", ")}.` : "Saved without changes." } };
    }
    const saved = await saveAuthenticatedPollDraft(slug, { id: draftId, commandId: crypto.randomUUID(), expectedVersion: input.version, data });
    return NextResponse.json({ draft: saved }, { headers });
  } catch (error) {
    const status = error instanceof CommonsAuthenticationRequiredError ? 401
      : error instanceof CommandAccessError || error instanceof CommonsMembershipRequiredError ? 403
      : error instanceof CommandConflictError ? 409 : error instanceof PollInferenceLimitError ? 429
      : error instanceof ZodError || error instanceof SyntaxError ? 400 : 503;
    const message = status === 409 ? "This draft changed in another tab. Reload the saved draft before continuing; nothing was sent."
      : status === 403 ? "This review is not available to your account."
      : status === 401 ? "Sign in again to continue reviewing."
      : error instanceof PollInferenceLimitError ? error.message
      : status === 400 ? "Check the message and questions. Your saved draft is unchanged."
      : "That change couldn’t be completed. Reload to check the saved draft, or try again. Nothing was sent.";
    return NextResponse.json({ error: message }, { status, headers });
  }
}
