import { ZodError } from "zod";
import { readBoundedJson } from "../bounded-json";
import { clientHash, INQUIRY_LIMITS, inquirySourcePath, inquirySpamVerdict, PartnerInquirySchema, type PartnerInquiryInput } from "./inquiry";

type SaveResult = { status: "created" | "duplicate" | "rate_limited"; id?: string };

/**
 * POST handler for the partner inquiry capture. Everything it touches is injected, so tests use no database and send nothing.
 * Responses never reveal where an inquiry is routed or whether delivery has happened.
 */
export function createInquiryRouteHandler(deps: {
  enabled: () => boolean;
  routeEmail: () => string | null;
  salt: () => string;
  save: (input: Omit<PartnerInquiryInput, "fax" | "elapsedMs"> & { clientHash: string; routedTo: string | null }) => Promise<SaveResult>;
  afterSave: (id: string) => void;
}) {
  return async function POST(request: Request) {
    if (!deps.enabled()) return Response.json({ error: "Not found." }, { status: 404 });
    try {
      const input = PartnerInquirySchema.parse(await readBoundedJson(request, 12_000));
      const verdict = inquirySpamVerdict(input);
      // A bot sees success and nothing is stored. A person with links or markup gets a plain, actionable message.
      if (verdict === "silent") return Response.json({ received: true }, { status: 202 });
      if (verdict === "reject") return Response.json({ error: "Remove links and formatting from the message, then send it again." }, { status: 422 });
      const { fax: _fax, elapsedMs: _elapsed, ...rest } = input;
      void _fax; void _elapsed;
      const result = await deps.save({ ...rest, sourcePath: inquirySourcePath(rest.sourcePath), clientHash: clientHash(request.headers.get("x-forwarded-for"), deps.salt()), routedTo: deps.routeEmail() });
      if (result.status === "rate_limited") return Response.json({ error: "Too many inquiries from here. Try again in an hour." }, { status: 429, headers: { "Retry-After": "3600" } });
      if (result.status === "created" && result.id) deps.afterSave(result.id);
      return Response.json({ received: true }, { status: result.status === "created" ? 201 : 200 });
    } catch (error) {
      if (error instanceof SyntaxError && error.message === "Command too large.") return Response.json({ error: "That message is too long. Shorten it and send it again." }, { status: 413 });
      if (error instanceof ZodError || error instanceof SyntaxError) return Response.json({ error: "Inquiry not sent. Check the highlighted fields and try again." }, { status: 400 });
      return Response.json({ error: "Inquiry not sent. Your message is still here. Try again." }, { status: 503 });
    }
  };
}

export { INQUIRY_LIMITS };
