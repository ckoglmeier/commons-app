import { ZodError } from "zod";
import { ActivateWorkflowVersionSchema, SaveWorkflowVersionSchema, type WorkflowTemplate } from "@commons/contracts";
import { CommandConflictError } from "@commons/database";
import { readBoundedJson } from "./bounded-json";

type Dependencies = {
  authorize: () => Promise<string | null>;
  list: () => Promise<WorkflowTemplate[]>;
  save: (input: unknown, operatorId: string) => Promise<WorkflowTemplate>;
  activate: (input: unknown, operatorId: string) => Promise<WorkflowTemplate>;
};
const headers = { "Cache-Control": "private, no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });

/** Auth is checked before reading any body or exposing configuration. No trip data. */
export function workflowAdminHandlers(dependencies: Dependencies) {
  const handle = (method: "GET" | "POST" | "PATCH") => async (request: Request) => {
    try {
      const operatorId = await dependencies.authorize();
      if (!operatorId) return json({ error: "Operator access is required." }, 403);
      if (method === "GET") return json({ templates: await dependencies.list() });
      if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "Use the Commons admin page to change workflows." }, 403);
      if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ error: "Send a JSON command." }, 415);
      const raw = await readBoundedJson(request, 60_000);
      const template = method === "POST"
        ? await dependencies.save(SaveWorkflowVersionSchema.parse(raw), operatorId)
        : await dependencies.activate(ActivateWorkflowVersionSchema.parse(raw), operatorId);
      return json({ template });
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) return json({ error: "Check the workflow fields and try again." }, 400);
      if (error instanceof CommandConflictError) return json({ error: "This workflow changed. Review the latest versions before trying again." }, 409);
      // Never echo instructions, identifiers, credentials, SQL or provider messages.
      return json({ error: "The workflow could not be saved. Your text is still here; try again." }, 500);
    }
  };
  return { GET: handle("GET"), POST: handle("POST"), PATCH: handle("PATCH") };
}
