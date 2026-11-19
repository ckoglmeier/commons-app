"use client";

import Link from "next/link";
import { useRef } from "react";
import type { DatesLocationRunDetail } from "@commons/contracts";
import { stableCommand } from "@/lib/recipe-client";
import type { PanelProps } from "./recipe-shared";

export function RecipeAdvicePanel({ slug, run, busy, act, call, runBase, draftDirty = false }: PanelProps & { slug: string; run: DatesLocationRunDetail; draftDirty?: boolean }) {
  const command = useRef<{ key: string; id: string } | null>(null);
  const advice = run.advice, evidence = run.connectedEvidence;
  if (!advice || !evidence || !evidence.sources.length) return null;
  const personName = (id: string) => evidence.currentAudience.find(person => person.personId === id)?.name ?? "Participant";
  const proposed = advice.proposedConfiguration;
  async function adopt() {
    command.current = stableCommand(command.current, { fingerprint: advice!.evidenceFingerprint, version: run.draft.version });
    await act(() => call(`${runBase}/advice`, "POST", { commandId: command.current!.id, expectedDraftVersion: run.draft.version,
      evidenceFingerprint: advice!.evidenceFingerprint, sourcePollIds: advice!.sourceFingerprints.map(source => source.pollId) }), "Saved the suggested questions in the private draft. Review them before sharing.");
  }
  return <section className="recipe-section" aria-labelledby="recipe-advice-title">
    <p className="recipe-note">Commons · Rules-based advice · {evidence.sources.length} {evidence.sources.length === 1 ? "round" : "rounds"} reviewed</p>
    <h2 id="recipe-advice-title">{advice.title}</h2>
    <p>{advice.reason}</p>
    {advice.constraints.length ? <div className="recipe-attention"><h3>Needs to resolve</h3><ul className="recipe-history">{advice.constraints.map(need => <li key={`${need.source.pollId}:${need.source.responseId}:${need.source.questionId}`}><strong>{need.name}</strong>: {need.text} · <Link href={`/c/${encodeURIComponent(slug)}/polls/${need.source.pollId}`}>Source round</Link></li>)}</ul><p className="recipe-note">Only organizers see these. Leaving a need out of a later question doesn’t resolve it.</p></div> : null}
    {proposed ? <div className="recipe-confirm"><h3>Suggested private draft</h3>{proposed.blocks.map(block => <div key={block.id}><p>{block.prompt}</p><ul className="recipe-history">{block.options.map(option => <li key={option.id}>{option.startsOn ? `${option.startsOn}–${option.endsOn}` : ""}{option.place ? `${option.startsOn ? " · " : ""}${option.place}` : option.label ?? ""}</li>)}</ul></div>)}
      <p className="recipe-note">Estimated effort: {advice.estimatedDecisionsPerRespondent} option decisions per person, {advice.estimatedTotalDecisions} across the current {evidence.currentAudience.length} invitees.</p>
      {!run.draft.published ? <><button type="button" className="cm-action" disabled={busy || draftDirty} onClick={adopt}>Use these questions in the private draft</button>{draftDirty ? <p className="recipe-note">Save your question edits first.</p> : null}</> : <p className="recipe-note">Start a replacement private draft before adopting these questions.</p>}
    </div> : null}
    <p className="recipe-note">When to stop: {advice.stoppingCondition}</p>
    <details className="fieldnotes-context"><summary>Evidence and outstanding coverage</summary>
      <p className="recipe-note">Earlier answers remain in their original rounds. They inform this advice; a new round starts with no votes. The current intended audience is {evidence.currentAudience.map(person => person.name).join(", ") || "not set"}.</p>
      {advice.unknowns.length ? <ul className="recipe-history">{advice.unknowns.map(unknown => <li key={unknown}>{unknown}</li>)}</ul> : null}
      <ul className="recipe-history">{advice.facts.map(fact => <li key={`${fact.dimension}:${fact.optionId}`}><strong>{fact.label}</strong> · {fact.yesPersonIds.length} yes, {fact.maybePersonIds.length} conditional, {fact.noPersonIds.length} unavailable, {fact.abstainedPersonIds.length} abstained, {fact.missingPersonIds.length} without availability feedback.
        {fact.missingPersonIds.length ? <span> Awaiting availability: {fact.missingPersonIds.map(personName).join(", ")}.</span> : null}
        {fact.unknownIdentityCount ? <span> {fact.unknownIdentityCount} response identities cannot establish current audience coverage.</span> : null}
        {fact.hasPreference ? <span> Preference signals are separate from availability.</span> : null}
        {!fact.sources.length ? <span> New or changed option; no prior matching support.</span> : null}
      </li>)}</ul>
      <ul className="recipe-history">{evidence.sources.map(source => <li key={source.pollId}><Link href={`/c/${encodeURIComponent(slug)}/polls/${source.pollId}`}>Round {source.round}</Link> · {source.status}{source.superseded ? " · earlier version" : ""} · {source.audience ? `${source.audience.personIds.length} named invitees` : "public link, unknown intended coverage"}</li>)}</ul>
    </details>
  </section>;
}
