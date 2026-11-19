import { ActivateWorkflowVersionSchema, SaveWorkflowVersionSchema, WorkflowTemplateSchema, type WorkflowPurpose, type WorkflowTemplate } from "@commons/contracts";

/** Synthetic editor specimen. Does not read trip data or authorize admin endpoints. */
export const workflowEditorFixtures: WorkflowTemplate[] = ([
  ["trip_feasibility", "Find dates and a destination"], ["attendance_confirmation", "Confirm who is coming"], ["lodging_selection", "Choose where to stay"], ["general_poll", "Ask another group question"], ["itinerary", "Build and refine an itinerary"],
] as const).map(([key, title], index) => WorkflowTemplateSchema.parse({ id: `98000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, key, title, description: "Synthetic drafting workflow for editor testing.", purpose: key as WorkflowPurpose, instructions: "Use saved trip constraints and supplied evidence. Keep unknown facts unresolved. Draft only; saving, sharing and booking need separate human actions.", version: 1, status: "active", createdAt: "2026-10-03T12:00:00.000Z" }));

export function createWorkflowEditorFixtureTransport(initial = workflowEditorFixtures): typeof fetch {
  const templates = structuredClone(initial);
  const replays = new Map<string, { fingerprint: string; id: string }>();
  return async (input, options) => {
    if (String(input) !== "/api/v1/admin/workflows") throw new Error("Only synthetic editor commands are allowed.");
    const method = options?.method ?? "GET";
    if (method === "GET") return Response.json({ templates });
    const raw = JSON.parse(String(options?.body)), fingerprint = JSON.stringify([method, raw]);
    const replay = replays.get(raw.commandId);
    if (replay) return replay.fingerprint === fingerprint ? Response.json({ template: templates.find(row => row.id === replay.id) }) : Response.json({ error: "Synthetic command conflict." }, { status: 409 });
    let saved: WorkflowTemplate;
    if (method === "POST") {
      const command = SaveWorkflowVersionSchema.parse(raw);
      const latest = templates.filter(row => row.key === command.definition.key).sort((a, b) => b.version - a.version)[0];
      if ((latest?.version ?? 0) !== command.expectedLatestVersion || latest && latest.purpose !== command.definition.purpose) return Response.json({ error: "Synthetic version conflict. Your text is preserved." }, { status: 409 });
      saved = { ...command.definition, id: crypto.randomUUID(), version: command.expectedLatestVersion + 1, status: "draft", createdAt: new Date().toISOString() };
      templates.push(saved);
    } else {
      const command = ActivateWorkflowVersionSchema.parse(raw);
      const chosen = templates.find(row => row.id === command.id), family = templates.filter(row => row.key === chosen?.key).sort((a, b) => b.version - a.version);
      const active = family.find(row => row.status === "active");
      if (!chosen || chosen.status !== "draft" || family[0].id !== chosen.id || (active?.id ?? null) !== command.expectedActiveId) return Response.json({ error: "Synthetic activation conflict." }, { status: 409 });
      if (active) active.status = "retired";
      chosen.status = "active"; saved = chosen;
    }
    replays.set(raw.commandId, { fingerprint, id: saved.id });
    return Response.json({ template: saved });
  };
}
