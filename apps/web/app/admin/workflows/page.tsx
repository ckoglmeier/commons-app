import Link from "next/link";
import { notFound } from "next/navigation";
import { listWorkflowTemplates } from "@commons/database";
import { CommonsWordmark } from "@commons/ui";
import { CommonsOperatorRequiredError, requireCommonsOperator } from "@/lib/server/operator";
import { requireCommonsDatabaseUrl } from "@/lib/server/runtime-environment";
import { WorkflowEditor } from "./workflow-editor";

export const dynamic = "force-dynamic";
export default async function WorkflowAdminPage() {
  try { await requireCommonsOperator(); }
  catch (error) { if (error instanceof CommonsOperatorRequiredError) notFound(); throw error; }
  const templates = await listWorkflowTemplates(requireCommonsDatabaseUrl());
  return <main className="operator-shell">
    <header className="creation-header"><Link className="entry-brand" href="/"><CommonsWordmark /></Link><Link href="/admin">Back to admin</Link></header>
    <div className="operator-content"><header className="operator-intro"><span className="view-kicker">Commons admin</span><h1>Workflows</h1><p>Improve how Commons helps draft polls and itineraries. Changes affect new drafts after activation; existing drafts keep their version.</p></header>
      <WorkflowEditor initialTemplates={templates} />
    </div>
  </main>;
}
