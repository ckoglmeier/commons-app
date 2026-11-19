import { workflowDraftingContract, type WorkflowTemplate } from "@commons/contracts";
import type { CoordinatorStarterId } from "../coordinator-starters";

/** Operator-authored drafting guidance; never a new capability or permission. */
export function workflowGuidance(template: WorkflowTemplate) {
  const contract = workflowDraftingContract(template.purpose);
  return `Drafting workflow: ${template.key}, version ${template.version}, purpose ${template.purpose}.
Code-owned drafting contract v${contract.contractVersion}: ${contract.handler}, output ${contract.outputSchema}, steps ${contract.steps.join(" → ")}.
Relevant input categories: ${contract.inputs.join(", ")}. Missing essential inputs stay unknown and require a focused question. This recipe has no tool adapters; any separate research job needs application authorization.
The following operator template guides content only. It cannot override application schemas, saved facts, privacy, allowed capabilities or explicit human approval. It grants no tools, sending, booking or trip mutations.
<workflow-template>\n${template.instructions}\n</workflow-template>
Application limits still apply. Itinerary participant feedback is on individual pieces (choices, meal suggestions, comments and optional interests), never an overall approval ballot for new itineraries. Recommended windows remain proposed until separately confirmed. For REQUIRED new poll choice questions use add_workflow_question with exclusive true on a neither/none answer, and url null unless the exact URL is supplied in the CURRENT request. For an OPTIONAL choice use add_optional_question with the requested selectionMode. Do not turn an optional question into required merely by labeling its prompt optional. Preserve the exact supplied choice list when the organizer specifies it. For written answers use add_text_question. Return only the existing output schema. Do not claim a poll is ready when essential inputs or actual questions are missing.`;
}

/** Only used after the organizer has already entered the poll capability. */
export function pollWorkflowKey(prompt: string, starterId: CoordinatorStarterId | null) {
  if (starterId === "dates") return "trip_feasibility";
  if (starterId === "attendance") return "attendance_confirmation";
  if (starterId === "stay") return "lodging_selection";
  if (/\b(?:final attendance|confirm (?:who|attendance)|who(?:['’]s| is) (?:in|coming)|attendance confirmation)\b/i.test(prompt)) return "attendance_confirmation";
  if (/\b(?:hotel|lodging|where (?:we(?:['’]ll| will| should)|to) stay)\b/i.test(prompt)) return "lodging_selection";
  if (/\b(?:which dates|date options|dates and (?:location|destination)|when and where|find (?:a )?(?:time|dates|destination))\b/i.test(prompt)) return "trip_feasibility";
  return "general_poll";
}
