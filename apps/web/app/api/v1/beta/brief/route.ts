import { betaFeatureEnabled } from "@/lib/beta/flags";
import { parseAssistantBrief } from "@/lib/beta/assistant-brief";
import { readBoundedJson } from "@/lib/bounded-json";
import { readCommonsRuntimeEnvironment } from "@/lib/server/runtime-environment";

/**
 * Previews a pasted assistant brief. It reads text and returns a proposal; it creates no draft, trip, invitation or payment and needs no
 * account. Starting a private draft from the proposal is a separate explicit action through the existing creation path.
 */
export async function POST(request: Request) {
  if (!betaFeatureEnabled("inquiry", readCommonsRuntimeEnvironment()) && !betaFeatureEnabled("successor", readCommonsRuntimeEnvironment())) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  try {
    const body = await readBoundedJson(request, 8_000) as { brief?: unknown };
    if (typeof body?.brief !== "string") return Response.json({ error: "Paste the brief text." }, { status: 400 });
    const parsed = parseAssistantBrief(body.brief);
    return parsed.ok ? Response.json({ proposal: parsed.proposal }) : Response.json({ error: parsed.error }, { status: 422 });
  } catch (error) {
    if (error instanceof SyntaxError && error.message === "Command too large.") return Response.json({ error: "That brief is too long." }, { status: 413 });
    return Response.json({ error: "Paste the brief text." }, { status: 400 });
  }
}
