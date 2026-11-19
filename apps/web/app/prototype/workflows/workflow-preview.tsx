"use client";
import { useState } from "react";
import { WorkflowEditor } from "@/app/admin/workflows/workflow-editor";
import { createWorkflowEditorFixtureTransport, workflowEditorFixtures } from "@/lib/workflow-editor-fixture";

export function WorkflowPreview() {
  const [fetcher] = useState(() => createWorkflowEditorFixtureTransport());
  return <WorkflowEditor initialTemplates={workflowEditorFixtures} fetcher={fetcher} />;
}
