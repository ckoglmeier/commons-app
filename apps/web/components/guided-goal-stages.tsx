"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import type { RecipeRunDetail } from "@commons/contracts";
import { GoalStages } from "./goal-stages";
import { AttendanceDecide, AttendanceDraft, AttendanceOutcome, AttendanceSummaryView } from "./recipe-attendance";
import { DatesLocationDecide, DatesLocationDraft, DatesLocationOutcome, DatesLocationOverlap, DatesLocationExploration } from "./recipe-dates-location";
import { LodgingDecide, LodgingDraft, LodgingOutcome, LodgingSummaryView } from "./recipe-lodging";
import { CloseVotingControl, History, ParticipantPollPreview, ReviseRoundControl, SavedPollShare, type DraftLayout, type PanelProps } from "./recipe-shared";
import { RecipeContextView } from "./recipe-context";
import { RecipeAdvicePanel } from "./recipe-advice";
import { RecipeDecisionRecap } from "./recipe-decision-recap";
import { RecipeNextStep } from "./recipe-next-step";

type GuidedRun = Exclude<RecipeRunDetail, { recipe: "food_preferences" }>;
/** Presentation only. Existing editors and approval commands retain their authority and version checks. */
export function GuidedGoalStages({ slug, run, goalBuild, goalDecide, draftEpoch, draftDirty, onDirtyChange, ...common }: PanelProps<GuidedRun> & {
  slug: string; goalBuild?: ReactNode; goalDecide?: ReactNode; draftEpoch: number; draftDirty: boolean; onDirtyChange: (dirty: boolean) => void;
}) {
  const context = <RecipeContextView slug={slug} run={run} />;
  const advice = run.recipe === "dates_location" ? <RecipeAdvicePanel slug={slug} run={run} draftDirty={draftDirty} {...common} /> : null;
  const draftDecide = <section className="recipe-section"><p>Share the poll to collect answers. Reviewing answers and approving a result won’t update the trip automatically.</p></section>;
  const layout: DraftLayout = (build, share) => <GoalStages initialStage="build" build={<>{goalBuild}{context}{advice}{build}</>} share={share} decide={draftDecide} />;
  if (run.stage === "draft") return <>
    {run.recipe === "dates_location" ? <DatesLocationDraft key={`${run.draft.id}:${draftEpoch}`} run={run} layout={layout} onDirtyChange={onDirtyChange} {...common} />
      : run.recipe === "attendance" ? <AttendanceDraft key={`${run.draft.id}:${draftEpoch}`} run={run} layout={layout} {...common} />
      : <LodgingDraft key={`${run.draft.id}:${draftEpoch}`} run={run} layout={layout} {...common} />}
    <History slug={slug} run={run} />
  </>;
  const active = Boolean(run.poll && !run.poll.superseded && run.stage !== "closed");
  const collecting = active && run.poll?.status === "open";
  const recorded = active && run.outcome && ["decided", "applied"].includes(run.stage);
  const awaiting = run.summary && "awaiting" in run.summary ? run.summary.awaiting : null;
  const summary = run.recipe === "dates_location" ? run.exploratory ? <DatesLocationExploration run={run} /> : run.summary ? <DatesLocationOverlap run={run} /> : null
    : run.recipe === "attendance" ? run.summary ? <AttendanceSummaryView run={run} /> : null : run.summary ? <LodgingSummaryView run={run} /> : null;
  const build = <>{goalBuild}<section className="recipe-section"><ParticipantPollPreview run={run} /><p className="recipe-note">This round stays as published. Start a private revision to change the questions; earlier answers remain in history.</p><ReviseRoundControl run={run} {...common} /></section></>;
  const decide = <>
    {!active ? <section className="recipe-section"><h3>This round is closed</h3><p>It was replaced or withdrawn. Its answers are history, not a new decision. <Link href={`/c/${encodeURIComponent(slug)}/ask`}>Back to Ask the group</Link></p></section> : null}
    {!recorded || run.context?.changed ? context : null}{!recorded ? advice : null}
    {collecting ? <p className="recipe-note">{run.poll!.responseCount} {run.poll!.responseCount === 1 ? "answer" : "answers"} so far.{awaiting?.length ? ` Still to answer: ${awaiting.join(", ")}.` : ""} Close voting when you’re ready to review a result.</p> : !run.poll?.responseCount ? <p className="recipe-attention">Voting closed · no answers. No responses were received; nothing has been decided for you.</p> : null}
    {!recorded ? summary : null}
    {collecting ? <CloseVotingControl run={run} base={`/api/v1/commons/${encodeURIComponent(slug)}`} {...common} /> : null}
    {active && run.stage === "decide" ? run.recipe === "dates_location" ? !run.exploratory ? <DatesLocationDecide run={run} {...common} /> : null : run.recipe === "attendance" ? <AttendanceDecide run={run} {...common} /> : <LodgingDecide run={run} {...common} /> : null}
    {recorded ? <>
      {run.recipe === "dates_location" ? <DatesLocationOutcome run={run} {...common} /> : run.recipe === "attendance" ? <AttendanceOutcome run={run} slug={slug} {...common} /> : <LodgingOutcome run={run} {...common} />}
      {goalDecide}
      <RecipeDecisionRecap key={run.participantDecision?.publicId ?? run.draft.id} run={run} />
      <details className="recipe-secondary-actions"><summary>Answers and planning context</summary>{!run.context?.changed ? context : null}{summary}{advice}</details>
      <details className="recipe-secondary-actions"><summary>Related planning</summary><RecipeNextStep slug={slug} run={run} /></details>
    </> : null}
    {active ? <details className="recipe-secondary-actions"><summary>Need another round?</summary><ReviseRoundControl run={run} {...common} /></details> : null}
    {active && !run.outcome ? <details className="recipe-secondary-actions"><summary>Ask a different follow-up question</summary><Link className="cm-action" href={`/c/${encodeURIComponent(slug)}/polls/new?followUp=${run.poll!.id}`}>Start a separate follow-up poll</Link><p className="recipe-note">Its answers are reviewed separately; they don’t complete this Goal.</p></details> : null}
  </>;
  return <><GoalStages key={run.draft.id} initialStage={run.poll?.responseCount || run.poll?.status === "closed" || !active ? "decide" : "share"} build={build} share={<SavedPollShare slug={slug} run={run} />} decide={decide} /><History slug={slug} run={run} /></>;
}
