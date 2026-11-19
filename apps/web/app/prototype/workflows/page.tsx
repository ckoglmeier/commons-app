import { notFound } from "next/navigation";
import Link from "next/link";
import { WorkflowPreview } from "./workflow-preview";

export default function WorkflowPrototype() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <main className="operator-shell"><div className="operator-content"><header className="operator-intro"><span className="view-kicker">Local synthetic preview</span><h1>Workflows</h1><p>Play with editing, creating, saving and activating versions. This specimen makes no network requests, uses synthetic instructions and resets on reload. It grants no admin access.</p><Link className="workflow-preview-link" href="/admin/workflows">Real admin editor · Operator sign-in required</Link></header><WorkflowPreview /></div></main>;
}
