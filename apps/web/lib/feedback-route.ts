import { feedbackPagePath, SubmitFeedbackRequestSchema, type SubmitFeedbackRequest } from "@commons/contracts";
import { ZodError } from "zod";
import { readBoundedJson } from "./bounded-json";

/** Thrown by a save function that refuses a submission because of spam limits (beta rework). The route answers 429 and keeps the draft. */
export class FeedbackLimitedError extends Error {
  constructor() { super("Too much feedback from here."); this.name = "FeedbackLimitedError"; }
}

export function createFeedbackRouteHandler({ save }: {
  save: (input: SubmitFeedbackRequest) => Promise<{ id: string }>;
}) {
  return async function POST(request: Request) {
    try {
      const input = SubmitFeedbackRequestSchema.parse(await readBoundedJson(request, 20_000));
      // Preserve the existing public-feedback boundary and bot suppression. This
      // writes a support record only; it grants no identity or event authority.
      if (input.website) return Response.json({ received: true }, { status: 202 });
      const submission = { ...input };
      delete submission.website;
      submission.pagePath = feedbackPagePath(submission.pagePath);
      const created = await save(submission);
      return Response.json({ id: created.id }, { status: 201 });
    } catch (error) {
      if (error instanceof SyntaxError && error.message === "Command too large.") {
        return Response.json({ error: "Feedback is too long. Shorten your message and try again." }, { status: 413 });
      }
      if (error instanceof FeedbackLimitedError) {
        return Response.json({ error: "Feedback not sent. Several reports arrived from here in the last hour. Your message is still here. Try again later." }, { status: 429, headers: { "Retry-After": "3600" } });
      }
      if (error instanceof ZodError || error instanceof SyntaxError) {
        return Response.json({ error: "Feedback not sent. Check your message and try again." }, { status: 400 });
      }
      // Do not log participant feedback or database error details.
      return Response.json({ error: "Feedback not sent. Your draft is still here. Try again." }, { status: 503 });
    }
  };
}
