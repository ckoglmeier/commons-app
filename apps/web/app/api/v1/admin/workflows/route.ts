import { activateWorkflowVersion, listWorkflowTemplates, saveWorkflowVersion } from "@commons/database";
import { workflowAdminHandlers } from "@/lib/workflow-admin-route";
import { CommonsOperatorRequiredError, requireCommonsOperator } from "@/lib/server/operator";
import { requireCommonsDatabaseUrl } from "@/lib/server/runtime-environment";

export const dynamic = "force-dynamic";
const handlers = workflowAdminHandlers({
  authorize: async () => {
    try { return (await requireCommonsOperator()).authUserId; }
    catch (error) { if (error instanceof CommonsOperatorRequiredError) return null; throw error; }
  },
  list: () => listWorkflowTemplates(requireCommonsDatabaseUrl()),
  save: (input, operatorId) => saveWorkflowVersion(input, operatorId, requireCommonsDatabaseUrl()),
  activate: (input, operatorId) => activateWorkflowVersion(input, operatorId, requireCommonsDatabaseUrl()),
});
export const GET = handlers.GET;
export const POST = handlers.POST;
export const PATCH = handlers.PATCH;
