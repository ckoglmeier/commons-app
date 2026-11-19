"use client";

import { useEffect, useRef, useState } from "react";
import { buildDatesLocationPollData, pollQuestionFormat, MAX_POLL_QUESTIONS, MAX_RECIPE_COMBINATIONS, DatesLocationConfigurationSchema, type DatesLocationBlock, type DatesLocationConfiguration, type DatesLocationRunDetail } from "@commons/contracts";
import { stableCommand } from "@/lib/recipe-client";
import { PublishPanel, type DraftLayout, type PanelProps } from "./recipe-shared";

const blockTitles = { dates: "Date availability", location: "Destination responses", combination: "Date and place feasibility", ranking: "Rank preferences", allocation: "Allocate ten points", text: "Written question", choice: "Simple choices" } as const;
const prompts = { dates: "Which dates could you do?", location: "How interested are you in each destination?", combination: "Which date-and-place options could you do? Select every option that works.", ranking: "Rank these options from first to last.", allocation: "Allocate ten points across these options.", text: "Anything else we should consider?", choice: "Which option fits you?" } as const;
const newOption = () => ({ id: crypto.randomUUID() });
const newBlock = (type: DatesLocationBlock["type"]): DatesLocationBlock => ({ id: crypto.randomUUID(), type, prompt: prompts[type], required: type !== "text", options: type === "text" ? [] : [newOption(), newOption()], ...(type === "ranking" || type === "allocation" ? { dimension: "location" as const } : {}), ...(type === "location" ? { scale: "interest" as const } : {}), ...(type === "choice" ? { selectionMode: "single" as const } : {}) });

export function RecipeConvergenceEditor({ run, busy, act, call, runBase, onDirtyChange, layout }: PanelProps<DatesLocationRunDetail> & { onDirtyChange?: (dirty: boolean) => void; layout?: DraftLayout }) {
  const [configuration, setConfiguration] = useState<DatesLocationConfiguration>(() => run.configuration ?? { version: 2, blocks: run.alternatives.length ? [{ id: run.questions?.find(question => question.kind === "choice" && question.selectionMode === "multiple")?.id ?? crypto.randomUUID(), type: "combination", prompt: prompts.combination, required: true, options: run.alternatives }] : [] });
  const [title, setTitle] = useState(run.title);
  const command = useRef<{ key: string; id: string } | null>(null);
  const parsed = DatesLocationConfigurationSchema.safeParse(configuration), error = parsed.success ? null : parsed.error.issues[0]?.message;
  const persisted = DatesLocationConfigurationSchema.safeParse(run.configuration);
  const saved = persisted.success && parsed.success && title === run.title && JSON.stringify(persisted.data) === JSON.stringify(parsed.data);
  const dirty = title !== run.title || (run.configuration ? !saved : configuration.blocks.length > 0);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  const update = (id: string, patch: Partial<DatesLocationBlock>) => setConfiguration(current => ({ ...current, blocks: current.blocks.map(block => block.id === id ? { ...block, ...patch } : block) }));
  type Option = DatesLocationBlock["options"][number];
  const editOption = (blockId: string, optionId: string, patch: Partial<Option> | ((current: Option) => Partial<Option>)) => setConfiguration(current => ({ ...current, blocks: current.blocks.map(block => block.id === blockId ? { ...block, options: block.options.map(option => option.id === optionId ? { ...option, ...(typeof patch === "function" ? patch(option) : patch) } : option) } : block) }));
  async function save() {
    if (!parsed.success) return;
    const built = buildDatesLocationPollData({ title, configuration: parsed.data, previous: { questions: run.questions ?? [] } });
    const canonical = built.recipeConfiguration!;
    setConfiguration(canonical);
    setTitle(built.title);
    const body = { title: built.title, configuration: canonical, expectedDraftVersion: run.draft.version };
    command.current = stableCommand(command.current, body);
    await act(() => call(`${runBase}/alternatives`, "POST", { ...body, commandId: command.current!.id }), "Questions saved. Still private to organizers.");
  }
  const build = <>
    <section className="recipe-section"><h2>Questions for this round</h2>
      <label className="fieldnotes-field"><span>Poll title</span><input disabled={busy} value={title} maxLength={120} onChange={event => setTitle(event.target.value)} /></label>
      <p className="recipe-note">Choose the questions for this round. Date availability and destination interest can narrow options. Only a date-and-place question can support a trip outcome.</p>
      <div className="poll-action-row">{Object.entries(blockTitles).map(([type, label]) => <button type="button" className="cm-action" key={type} disabled={busy || configuration.blocks.length >= MAX_POLL_QUESTIONS} onClick={() => setConfiguration(current => ({ ...current, blocks: [...current.blocks, newBlock(type as DatesLocationBlock["type"])] }))}>Add {label.toLowerCase()}</button>)}</div>
      {configuration.blocks.map((block, index) => <fieldset className="recipe-convergence-block" key={block.id} disabled={busy}>
        <legend>{index + 1}. {blockTitles[block.type]}</legend>
        <label className="fieldnotes-field"><span>Question</span><input maxLength={240} value={block.prompt} onChange={event => update(block.id, { prompt: event.target.value })} /></label>
        <label className="recipe-ack"><input type="checkbox" checked={block.required} onChange={event => update(block.id, { required: event.target.checked })} /><span>Required</span></label>
        {block.type === "location" ? <><label className="fieldnotes-field"><span>Response scale</span><select value={block.scale ?? "interest"} onChange={event => update(block.id, { scale: event.target.value as "interest" | "yes_maybe_no", prompt: event.target.value === "interest" ? prompts.location : "Could you go to each destination?" })}><option value="interest">Four interest levels</option><option value="yes_maybe_no">Yes / Maybe / No availability</option></select></label><p className="recipe-note">Availability here is not scoped to settled dates. It does not establish a date-and-place fit.</p></> : null}
        {block.type === "choice" ? <label className="fieldnotes-field"><span>Selection</span><select value={block.selectionMode} onChange={event => update(block.id, { selectionMode: event.target.value as "single" | "multiple" })}><option value="single">Choose one</option><option value="multiple">Choose all that apply</option></select></label> : null}
        {block.type === "ranking" || block.type === "allocation" ? <label className="fieldnotes-field"><span>Compare</span><select value={block.dimension} onChange={event => update(block.id, { dimension: event.target.value as "dates" | "location" | "combination", options: [newOption(), newOption()] })}><option value="location">Places</option><option value="dates">Dates</option><option value="combination">Dates and places together</option></select></label> : null}
        {block.options.map((option, optionIndex) => {
          const dimension = block.dimension ?? block.type;
          const updateOption = (patch: Partial<Option> | ((current: Option) => Partial<Option>)) => editOption(block.id, option.id, patch);
          return <fieldset className="recipe-alternative" key={option.id}><legend>Option {optionIndex + 1}</legend>
            {dimension === "dates" || dimension === "combination" ? <><label className="fieldnotes-field"><span>Start date</span><input type="date" value={option.startsOn ?? ""} onChange={event => { const startsOn = event.target.value || undefined; updateOption(current => ({ startsOn, endsOn: startsOn && current.endsOn && current.endsOn >= startsOn ? current.endsOn : startsOn })); }} /></label><label className="fieldnotes-field"><span>End date</span><input type="date" min={option.startsOn} value={option.endsOn ?? ""} onChange={event => updateOption({ endsOn: event.target.value || undefined })} /></label></> : null}
            {dimension === "location" || dimension === "combination" ? <label className="fieldnotes-field recipe-alternative__place"><span>Place</span><input value={option.place ?? ""} maxLength={60} onChange={event => updateOption({ place: event.target.value || undefined })} /></label> : null}
            {block.type === "choice" ? <label className="fieldnotes-field"><span>Answer label</span><input value={option.label ?? ""} maxLength={160} onChange={event => updateOption({ label: event.target.value || undefined })} /></label> : null}
            <button type="button" className="cm-action" disabled={block.options.length <= 2} aria-label={`Remove option ${optionIndex + 1} from question ${index + 1}`} onClick={() => update(block.id, { options: block.options.filter(item => item.id !== option.id) })}>Remove option</button>
          </fieldset>;
        })}
        <div className="poll-action-row">{block.type !== "text" ? <button type="button" className="cm-action" disabled={block.options.length >= MAX_RECIPE_COMBINATIONS} onClick={() => update(block.id, { options: [...block.options, newOption()] })}>Add option</button> : null}
          <button type="button" className="cm-action" onClick={() => setConfiguration(current => ({ ...current, blocks: current.blocks.filter(item => item.id !== block.id) }))}>Remove question</button></div>
      </fieldset>)}
      {error && configuration.blocks.length ? <p className="recipe-error" role="status">{error}</p> : null}
      <button type="button" className="cm-action" disabled={busy || saved || !parsed.success} onClick={save}>{saved ? "Saved" : "Save questions"}</button>
    </section>
    {run.configuration ? <section className="recipe-section"><h2>What people will see</h2>{run.questions?.map(question => <div className="recipe-preview" key={question.id}><strong>{question.prompt}</strong><p>{question.convergence ? `${question.convergence.dimension === "dates" ? "Date" : question.convergence.dimension === "location" ? "Destination" : "Date and place"} ${question.convergence.measure} · ` : ""}{pollQuestionFormat(question)} · {question.required ? "Required" : "Optional"}</p>{question.kind !== "text" ? <ul>{question.options.map(option => <li key={option.id}>{option.label}</li>)}</ul> : null}</div>)}</section> : null}
  </>;
  const share = <PublishPanel run={run} busy={busy} act={act} call={call} runBase={runBase} ready={saved && parsed.success} blockedReason="Save valid questions before sharing." />;
  return layout ? layout(build, share) : <>{build}{share}</>;
}
