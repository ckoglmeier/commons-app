"use client";

import { useRef, useState } from "react";
import { WorkflowDefinitionSchema, WorkflowPurposeSchema, WorkflowTemplateSchema, type WorkflowDefinition, type WorkflowPurpose, type WorkflowTemplate } from "@commons/contracts";
import "./workflows.css";

const purposes: Record<WorkflowPurpose, string> = {
  trip_feasibility: "Dates and destination poll", attendance_confirmation: "Final attendance poll",
  lodging_selection: "Lodging selection poll", general_poll: "General poll", itinerary: "Itinerary draft",
};
const blank: WorkflowDefinition = { key: "", title: "", description: "", purpose: "general_poll", instructions: "" };
const definitionOf = (template: WorkflowTemplate): WorkflowDefinition => ({ key: template.key, title: template.title, description: template.description, purpose: template.purpose, instructions: template.instructions });

export function WorkflowEditor({ initialTemplates, fetcher = fetch }: { initialTemplates: WorkflowTemplate[]; fetcher?: typeof fetch }) {
  const [templates, setTemplates] = useState(initialTemplates);
  const [selectedId, setSelectedId] = useState<string | null>(initialTemplates[0]?.id ?? null);
  const [form, setForm] = useState<WorkflowDefinition>(initialTemplates[0] ? definitionOf(initialTemplates[0]) : blank);
  const [pending, setPending] = useState(false), [confirmActivation, setConfirmActivation] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const retry = useRef<{ fingerprint: string; commandId: string } | null>(null);
  const selected = templates.find(item => item.id === selectedId);
  const baseline = selected ? definitionOf(selected) : blank;
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline);
  const versions = templates.filter(item => item.key === form.key).sort((a, b) => b.version - a.version);
  const latest = versions[0], active = versions.find(item => item.status === "active");
  const keys = [...new Set(templates.map(item => item.key))].sort();
  const canActivate = selected?.status === "draft" && selected.id === latest?.id && !dirty;

  function select(id: string | null) {
    const next = templates.find(item => item.id === id);
    setSelectedId(id); setForm(next ? definitionOf(next) : { ...blank });
    setNotice(null); setConfirmActivation(false); retry.current = null;
  }
  function edit(field: keyof WorkflowDefinition, value: string) {
    setForm(current => ({ ...current, [field]: value })); setConfirmActivation(false); setNotice(null);
  }
  async function refreshVersions() {
    const response = await fetcher("/api/v1/admin/workflows", { cache: "no-store" });
    if (response.ok) {
      const body = await response.json();
      setTemplates(WorkflowTemplateSchema.array().parse(body.templates));
    }
  }
  async function command(method: "POST" | "PATCH") {
    const validated = WorkflowDefinitionSchema.safeParse(form);
    if (method === "POST" && !validated.success) { setNotice({ error: true, text: "Add a key, title, description and at least 20 characters of instructions." }); return; }
    if (method === "PATCH" && (!canActivate || !confirmActivation)) return;
    const payload = method === "POST" ? { expectedLatestVersion: latest?.version ?? 0, definition: validated.data }
      : { id: selected!.id, expectedActiveId: active?.id ?? null };
    const fingerprint = JSON.stringify([method, payload]);
    const commandId = retry.current?.fingerprint === fingerprint ? retry.current.commandId : crypto.randomUUID();
    retry.current = { fingerprint, commandId };
    setPending(true); setNotice(null);
    try {
      const response = await fetcher("/api/v1/admin/workflows", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ commandId, ...payload }) });
      const body = await response.json();
      if (!response.ok) {
        if (response.status === 409) await refreshVersions().catch(() => {});
        setNotice({ error: true, text: typeof body.error === "string" ? body.error : "Could not save. Your text is preserved." }); return;
      }
      const saved = WorkflowTemplateSchema.parse(body.template);
      setTemplates(current => [...current.filter(item => item.id !== saved.id).map(item => method === "PATCH" && saved.status === "active" && item.key === saved.key && item.status === "active" && item.id !== saved.id ? { ...item, status: "retired" as const } : item), saved]);
      setSelectedId(saved.id); setForm(definitionOf(saved)); setConfirmActivation(false); retry.current = null;
      setNotice({ error: false, text: method === "POST" ? `Version ${saved.version} saved as a draft. Activate it when ready.` : saved.status === "active" ? `Version ${saved.version} is active for new drafts. Existing drafts are unchanged.` : "That activation was already processed. Review the current active version." });
      await refreshVersions().catch(() => {});
    } catch { setNotice({ error: true, text: "Could not confirm the save. Your text is preserved; retry safely." }); }
    finally { setPending(false); }
  }

  return <div className="workflow-editor">
    <aside className="workflow-list" aria-label="Workflow catalog">
      {keys.map(key => { const family = templates.filter(item => item.key === key).sort((a, b) => b.version - a.version); const current = family.find(item => item.status === "active") ?? family[0]; return <button type="button" key={key} disabled={pending || dirty} aria-current={form.key === key ? "true" : undefined} onClick={() => select(current.id)}><strong>{current.title}</strong><span>{purposes[current.purpose]} · {current.status === "active" ? `Active v${current.version}` : "Not active"}</span></button>; })}
      <button type="button" className="workflow-secondary" disabled={pending || dirty} onClick={() => select(null)}>New workflow</button>
      {dirty ? <p>Save this version or discard your changes before switching.</p> : null}
    </aside>
    <section className="workflow-form" aria-label="Workflow editor">
      {selected ? <div className="workflow-version"><label htmlFor="workflow-version">Version</label><select id="workflow-version" value={selected.id} disabled={pending || dirty} onChange={event => select(event.target.value)}>{versions.map(item => <option key={item.id} value={item.id}>Version {item.version} · {item.status}</option>)}</select><p>Editing always saves a new revision. Older versions remain available to pinned drafts.</p></div> : <h2>New workflow</h2>}
      <form onSubmit={event => { event.preventDefault(); void command("POST"); }}>
        <label htmlFor="workflow-key">Workflow key</label><input id="workflow-key" value={form.key} disabled={pending || Boolean(selected)} required pattern="[a-z][a-z0-9_]{2,63}" maxLength={64} onChange={event => edit("key", event.target.value)} aria-describedby="workflow-key-help" />
        <p id="workflow-key-help">A stable key, such as weekend_lodging. New drafts can select this workflow by key.</p>
        <label htmlFor="workflow-purpose">Supported handler</label><select id="workflow-purpose" value={form.purpose} disabled={pending || Boolean(selected)} onChange={event => edit("purpose", WorkflowPurposeSchema.parse(event.target.value))}>{Object.entries(purposes).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
        <label htmlFor="workflow-title">Title</label><input id="workflow-title" value={form.title} disabled={pending} required maxLength={120} onChange={event => edit("title", event.target.value)} />
        <label htmlFor="workflow-description">Description</label><textarea id="workflow-description" value={form.description} disabled={pending} required maxLength={500} rows={2} onChange={event => edit("description", event.target.value)} />
        <label htmlFor="workflow-instructions">Template instructions</label><textarea id="workflow-instructions" className="workflow-instructions" value={form.instructions} disabled={pending} required minLength={20} maxLength={12000} rows={14} onChange={event => edit("instructions", event.target.value)} aria-describedby="workflow-scope" />
        <p id="workflow-scope">Instructions guide drafting only. They cannot grant tools, send messages, make bookings, or bypass human approval. Keep trip-specific or personal details out of templates.</p>
        <div className="workflow-actions"><button type="submit" disabled={pending || !dirty}>{pending ? "Working…" : "Save new version"}</button>{dirty ? <button type="button" className="workflow-secondary" disabled={pending} onClick={() => select(selectedId)}>Discard changes</button> : null}</div>
      </form>
      {canActivate ? <div className="workflow-activation"><p>Activate version {selected.version} for new drafts? {active ? `It will replace version ${active.version}.` : "This workflow is not active yet."} Existing drafts keep their version.</p><label><input type="checkbox" checked={confirmActivation} disabled={pending} onChange={event => setConfirmActivation(event.target.checked)} />I approve this version for new drafts.</label><button type="button" disabled={pending || !confirmActivation} onClick={() => void command("PATCH")}>Activate version {selected.version}</button></div> : null}
      {notice ? <p className={notice.error ? "workflow-notice workflow-notice-error" : "workflow-notice"} role={notice.error ? "alert" : "status"}>{notice.text}</p> : null}
    </section>
  </div>;
}
