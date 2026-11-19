"use client";
import { CoordinatorDynamicWork } from "./coordinator-dynamic-work";
import { presentationCatalog } from "../lib/coordinator-presentation";

import { CompareStays } from "./compare-stays";
import { compareStaysSnapshot } from "../lib/compare-stays";
import { addRecordCommand, slashCommandChoices, type CoordinatorAddKind, coordinatorTool, putComposerTool } from "../lib/coordinator-tools";
import { mayPresentPollResult } from "@/lib/coordinator-poll-presentation";
import { SharedPollCard } from "./shared-poll-card";
import { itineraryOperation } from "@/lib/coordinator-artifact-intent";
import type { DocumentSave, DocumentState } from "@/lib/itinerary-document-autosave";
import { TimeInput } from "./time-input";
import { CommonsAssistantRuntime, CommonsComposerForm, CommonsMessage, CommonsReplyText } from "./coordinator-assistant-ui";
import { CoordinatorItinerary, type ItineraryReviewAction } from "./coordinator-itinerary";
import { CoordinatorComposerMenu, appendComposerHelp } from "./coordinator-composer-menu";
import { suggestRecipe } from "@/lib/recipe-suggest";
import { CoordinatorSourceAttachments } from "./coordinator-source-attachments";
import { CoordinatorTripTask } from "./coordinator-trip-task";

import { useOverviewLegacyTasks } from "./use-overview-legacy-tasks";
import { CoordinatorBrain } from "./coordinator-brain";
import { SuggestionAction, TripTasks, type TripTaskContext } from "./trip-tasks";
import type { ThingToDo } from "@commons/domain";
import { activityReceipt } from "@/lib/plan-receipt";
import { OrganizerGettingStarted } from "./organizer-getting-started";
import { GoalTaskRail, GoalTaskDetails, GoalMainReports, useGoalWorkspace, type GoalWorkspaceState } from "./coordinator-goals";
import { ResearchWorkspace } from "./research-workspace";
import { trackProductEvent } from "@/lib/product-analytics";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CoordinatorThreadSchema, pollQuestionFormat, PollWorkingDraftSchema, reportsOwnAttendance, type ThreadOutcome, type ThreadRelation, type CoordinatorThread, type CoordinatorRecommendation, type PollWorkingDraft, type TripChangeProposal, type TurnCommand, type TurnResult } from "@commons/contracts";
import { CoordinatorMark } from "@commons/ui";
import { TripCoordinatorSettings } from "./trip-coordinator-settings";
import { coordinatorPersonalities, type CoordinatorPersonalityId } from "@commons/contracts";
import { PlusIcon, UsersIcon, CheckIcon, PinIcon, CalendarIcon, HomeIcon, ArrowUpIcon, BookmarkIcon } from "./icons";
import { CoordinatorResearchTasks } from "./coordinator-research-tasks";
import { CoordinatorTaskPanel, LinkedOutcomes, SteeringChoices, SubthreadStarter, ThreadRelationNote } from "./coordinator-continuity";
import { continuityEndpoint, runTaskOperation, type TaskCapability } from "@/lib/coordinator-tasks-client";
import { CoordinatorLiveConversation } from "./coordinator-live-conversation";
import { elapsedMs, type VoiceDelegateOutcome, type VoiceDelegation } from "@/lib/coordinator-live";
import { CoordinatorReview } from "./coordinator-review";
import { LodgingFollowUp } from "./lodging-follow-up";
import { itineraryQuestion, isItineraryPaste } from "@/lib/itinerary-workshop";
import { ItineraryPortabilityPanel } from "./itinerary-portability-panel";
import type { ItineraryImportReceipt } from "@commons/contracts";

const returnedItinerary = (text: string) => /^```commons-itinerary[^\n]*$/m.test(text);
import { ItineraryDraftEditor } from "./itinerary-draft-editor";
import { ItineraryDocument } from "./itinerary-document";
import { ItineraryOrganizerActions } from "./itinerary-organizer-actions";
import { ItineraryFeedbackResults } from "./itinerary-feedback-results";
import { GlobalNavigation } from "./global-navigation";
import { useCoordinatorContext } from "./use-coordinator-context";
import { CoordinatorContextSelector, type ContextGroup } from "./coordinator-context-selector";
import { WorkspacePaneLayout, useRetainedScroll } from "./workspace-pane-layout";
import { DEFAULT_WORK_RATIO, persistWorkspaceHistory, readRatio, readWorkspaceHistory, surfaceMode, writeRatio } from "@/lib/workspace-presentation";
import { commonsViewPath, itemDetailPath, planSectionPath } from "@/lib/commons-route";
import { isCompactPlanProposal, PLAN_STATUS_LABEL, planLocalTimeLabel, planShortTimeLabel } from "@/lib/coordinator-plan-proposal";
import { defaultWorkspaceContext, workspaceContextTitle, workspaceContextTurns, workspaceThreadId, workspaceEditableDraft } from "@/lib/coordinator-workspace-context";
import { buildTurnCommand, commandKey, CoordinatorRequestError, coordinatorEndpoint, failureFrom, forgetPendingCommand, loadPendingCommands, recoverTurn, recoveryTiming, rememberPendingCommand, requestJson, sendTurnStream, settledMessage, signInHref, stopTurn, isSendShortcut, loadStoppedCommands, rememberStoppedCommand, type CommandDestination, type CoordinatorFailure, type TurnSettled } from "@/lib/coordinator-client";
import { isOwnTurn, retryCommandFor, selectedArtifact } from "@/lib/coordinator-turn-command";
import { clearUnsentIfSent, readUnsent, unsentDestinationFor, writeUnsent, rememberItineraryPaste, finishSavedItineraryPaste, type UnsentDestination } from "@/lib/coordinator-unsent";
import { ClarifyCandidates, isUnsupportedTurn, LiveTurn, researchRunView, TurnFailed, TurnPending, turnSources, turnStatusOf, type LiveTurnView } from "./coordinator-turn-parts";
import { coordinatorStarters, coordinatorStarter, starterMessage, type CoordinatorStarterId, type CoordinatorStarterFacts } from "@/lib/coordinator-starters";

type TripIdea = { id: string; title: string; status: "idea" | "planned" | "confirmed" | "cancelled"; provenanceLabel: string; sourceUrl?: string };

type WorkspaceProposal = NonNullable<NonNullable<CoordinatorThread["turns"][number]["workspace"]>["proposal"]>;

function ProposalPreview({ proposal }: { proposal: WorkspaceProposal }) {
  const itinerary = itineraryQuestion(proposal.data.questions);
  if (itinerary) return <ItineraryDocument itinerary={itinerary.itinerary} />;
  return <div className="workspace-revision-preview"><h3>{proposal.data.title}</h3><p>{proposal.data.intro}</p><h3>{proposal.data.communication?.heading}</h3>{proposal.data.communication?.paragraphs.map((text, i) => <p key={i}>{text}</p>)}{proposal.data.questions.map(question => <section key={question.id}><h3>{question.prompt}</h3><p>{pollQuestionFormat(question)}</p>{question.kind !== "text" ? <ul>{question.options.map(option => <li key={option.id}>{option.label}{option.description ? ` — ${option.description}` : ""}</li>)}</ul> : <p>Written response</p>}</section>)}</div>;
}

/** Exported for tests, which mount the whole Workspace and need these expanded. */
export function ProposalArtifact({ proposal, actedBy, busy, blocked, conflict, editable, onAction, turnId, draftId, onReview, previewed = false }: {
  proposal: WorkspaceProposal; actedBy?: { name: string }; busy: boolean; blocked: boolean; conflict: boolean;
  editable: PollWorkingDraft[]; onAction: (turnId: string, kind: "apply" | "dismiss") => void; turnId: string; draftId?: string | null;
  onReview?: (turnId: string) => void; previewed?: boolean;
}) {
  const pending = proposal.state === "pending";
  const status = pending ? `Not applied · Based on version ${proposal.baseVersion}` : proposal.state === "applied" ? "Applied to draft · Not shared" : "Kept current draft";
  if (pending && itineraryQuestion(proposal.data.questions) && onReview) return <section className="workspace-proposal" aria-label="Proposed itinerary changes">
    <h3>Proposed itinerary changes</h3><p>{proposal.changes.join(" · ")}</p><p className="review-caption">From your request and saved trip details · Draft version {proposal.baseVersion}. Applying updates only this draft.</p>
    <div className="workspace-actions"><button type="button" className="cm-action" disabled={busy || blocked} onClick={() => onReview(turnId)}>Review itinerary</button><button type="button" className="cm-action cm-action--primary" disabled={busy || blocked || conflict || !previewed || !editable.some(draft => draft.id === draftId && draft.version === proposal.baseVersion)} onClick={() => onAction(turnId, "apply")}>Apply to draft</button><button type="button" className="cm-action" disabled={busy || blocked || conflict} onClick={() => onAction(turnId, "dismiss")}>Keep current</button></div>
    {!editable.some(draft => draft.id === draftId && draft.version === proposal.baseVersion) ? <p className="review-caption">The draft changed or was published. Ask for a fresh proposal.</p> : null}
  </section>;
  const content = <><p className="review-caption">{status}{actedBy ? ` · ${proposal.state === "applied" ? "Applied" : "Kept"} by ${actedBy.name}` : ""}</p><p>{proposal.changes.join(", ")}</p><ProposalPreview proposal={proposal} /></>;
  if (!pending) return <details className="workspace-proposal workspace-proposal--resolved"><summary><span>{status}</span><span className="review-caption">View update</span></summary>{content}</details>;
  return <section className="workspace-proposal"><span className="view-kicker">Suggested edit</span><h3>{proposal.changes.join(", ")}</h3><p className="review-caption">Based on saved version {proposal.baseVersion}. Nothing changes until an organizer applies it. Applying changes only this draft; publishing and sharing are separate steps.</p><details className="workspace-proposal-preview"><summary>Review proposed version</summary><ProposalPreview proposal={proposal} /></details><div className="workspace-actions"><button className="cm-action cm-action--primary" disabled={busy || blocked || conflict || !editable.some(draft => draft.id === draftId && draft.version === proposal.baseVersion)} onClick={() => onAction(turnId, "apply")}>Apply to draft</button><button className="cm-action" disabled={busy || blocked || conflict} onClick={() => onAction(turnId, "dismiss")}>Keep current</button>{!editable.some(draft => draft.id === draftId && draft.version === proposal.baseVersion) ? <p className="review-caption">The draft changed or was published. Ask Commons for a fresh proposal.</p> : null}</div></section>;
}

export function TripChangeArtifact({ proposal, slug, busy, blocked, conflict, onAction, turnId, reportedBy }: {
  proposal: TripChangeProposal; slug: string; busy: boolean; blocked: boolean; conflict: boolean;
  onAction: (turnId: string, kind: "revise_trip" | "apply_trip" | "dismiss_trip", version: number, changes?: TripChangeProposal["changes"], planContact?: { text: string; include: boolean }) => void;
  turnId: string; reportedBy?: string;
}) {
  const [changes, setChanges] = useState(proposal.changes);
  // A status-only plan proposal opens as a compact confirmation (design §22). "Edit details" opens the full form in place; once a review edit has been
  // saved (version > 1) the full form stays, so save then Apply works as it always did.
  const [editing, setEditing] = useState(false);
  const [includeContact, setIncludeContact] = useState(proposal.changes.plan?.contact?.include ?? false);
  const focusReceipt = useRef(false);
  const headingId = useId();
  const [budgetText, setBudgetText] = useState(proposal.changes.budgetCents === null ? "" : (proposal.changes.budgetCents / 100).toFixed(2));
  const [stayCostText, setStayCostText] = useState(proposal.changes.stay?.totalCents === null || !proposal.changes.stay ? "" : (proposal.changes.stay.totalCents / 100).toFixed(2));
  const dirty = JSON.stringify(changes) !== JSON.stringify(proposal.changes);
  const pending = proposal.state === "pending";
  const money = (cents: number | null) => cents === null ? "Not set" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
  const moneyInput = (value: string): number | null | undefined => {
    if (!value.trim()) return null;
    const normalized = value.replace(/[$,\s]/g, "");
    if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) return undefined;
    return Math.round(Number(normalized) * 100);
  };
  const invalidMoney = (proposal.operations.includes("budget") && moneyInput(budgetText) === undefined)
    || (proposal.operations.includes("stay") && moneyInput(stayCostText) === undefined);
  const stay = changes.stay;
  const updateStay = (field: keyof NonNullable<TripChangeProposal["changes"]["stay"]>, value: string | number | null) => setChanges(valueNow => valueNow.stay ? { ...valueNow, stay: { ...valueNow.stay, [field]: value } } : valueNow);
  const plan = changes.plan ?? null, basePlan = proposal.base.plan ?? null;
  const updatePlan = (field: "status" | "startsOn" | "startsTime" | "note", value: string | null) => setChanges(valueNow => valueNow.plan ? { ...valueNow, plan: { ...valueNow.plan, [field]: value } } : valueNow);
  const planIncomplete = proposal.operations.includes("plan") && Boolean(plan) && (Boolean(plan?.startsOn) !== Boolean(plan?.startsTime));
  const compactPlan = isCompactPlanProposal(proposal) && basePlan && plan ? basePlan : null;
  const applyReviewed = (planContact?: { text: string; include: boolean }) => { focusReceipt.current = true; onAction(turnId, "apply_trip", proposal.version, undefined, planContact); };
  const fields = <div className="workspace-trip-fields">
    {proposal.operations.includes("budget") ? <label>Target trip budget · USD <span className="review-caption">Saved: {money(proposal.base.budgetCents)}</span><input inputMode="decimal" value={budgetText} onChange={event => { setBudgetText(event.target.value); const amount = moneyInput(event.target.value); if (amount !== undefined) setChanges(value => ({ ...value, budgetCents: amount })); }} disabled={!pending || busy} /></label> : null}
    {proposal.operations.includes("dates") ? <><label>Trip starts <span className="review-caption">Saved: {proposal.base.startsOn ?? "Not set"}</span><input type="date" value={changes.startsOn ?? ""} onChange={event => setChanges(value => ({ ...value, startsOn: event.target.value || null }))} disabled={!pending || busy} /></label><label>Trip ends <span className="review-caption">Saved: {proposal.base.endsOn ?? "Not set"}</span><input type="date" value={changes.endsOn ?? ""} onChange={event => setChanges(value => ({ ...value, endsOn: event.target.value || null }))} disabled={!pending || busy} /></label></> : null}
    {proposal.operations.includes("destination") ? <label>Trip destination <span className="review-caption">Saved: {proposal.base.locationName ?? "Not set"}</span><input value={changes.locationName ?? ""} onChange={event => setChanges(value => ({ ...value, locationName: event.target.value || null }))} disabled={!pending || busy} /></label> : null}
    {proposal.operations.includes("stay") && stay ? <fieldset><legend>{proposal.base.stay ? `Update ${proposal.base.stay.name}` : "Add a stay"}</legend><p className="review-caption">{proposal.base.stay ? "Existing stay. Only the fields shown here will change." : "Reported by an organizer. Commons has not verified a booking or payment."}</p>
      <label>Stay name <input value={stay.name} onChange={event => updateStay("name", event.target.value)} disabled={!pending || busy} /></label>
      <label>Address <span className="review-caption">Saved: {proposal.base.stay?.address ?? "Not set"}</span><input value={stay.address} onChange={event => updateStay("address", event.target.value)} disabled={!pending || busy} /></label>
      <label>Check-in date <span className="review-caption">Saved: {proposal.base.stay?.startsOn ?? "Not set"}</span><input type="date" value={stay.startsOn ?? ""} onChange={event => updateStay("startsOn", event.target.value || null)} disabled={!pending || busy} /></label>
      <label>Check-out date <span className="review-caption">Saved: {proposal.base.stay?.endsOn ?? "Not set"}</span><input type="date" value={stay.endsOn ?? ""} onChange={event => updateStay("endsOn", event.target.value || null)} disabled={!pending || busy} /></label>
      <label>Reported lodging cost · USD <span className="review-caption">Saved: {money(proposal.base.stay?.totalCents ?? null)}</span><input inputMode="decimal" value={stayCostText} onChange={event => { setStayCostText(event.target.value); const amount = moneyInput(event.target.value); if (amount !== undefined) updateStay("totalCents", amount); }} disabled={!pending || busy} /></label>
      <label>Booking link <input type="url" value={stay.bookingUrl ?? ""} onChange={event => updateStay("bookingUrl", event.target.value || null)} disabled={!pending || busy} /></label>
      <label>Status <select value={stay.status} onChange={event => updateStay("status", event.target.value)} disabled={!pending || busy}><option value="considering">Considering</option><option value="planned">Planned</option><option value="confirmed">Booked, as reported</option></select></label>
      <div className="workspace-trip-travelers"><strong>Who is included in this stay?</strong><p className="review-caption">Select at least one traveler. No expense or payment is created.</p>{proposal.travelers.map(traveler => <label key={traveler.id}><input type="checkbox" checked={changes.includedPersonIds.includes(traveler.id)} disabled={!pending || busy} onChange={event => setChanges(value => ({ ...value, includedPersonIds: event.target.checked ? [...value.includedPersonIds, traveler.id] : value.includedPersonIds.filter(id => id !== traveler.id) }))} />{traveler.name}</label>)}</div>
    </fieldset> : null}
    {proposal.operations.includes("plan") && plan && basePlan ? <fieldset><legend>Update “{basePlan.title}”</legend><p className="review-caption">An existing plan. Only the fields shown here will change. Travelers can see this plan and its note.</p>
      <label>Status <span className="review-caption">Saved: {PLAN_STATUS_LABEL[basePlan.status]}</span><select value={plan.status} onChange={event => updatePlan("status", event.target.value)} disabled={!pending || busy}>{basePlan.status === "idea" ? <option value="idea">Idea</option> : null}<option value="planned">Planned</option><option value="confirmed">Confirmed, as reported by an organizer</option><option value="cancelled">Cancelled</option></select></label>
      {plan.status === "confirmed" && basePlan.status !== "confirmed" ? <p className="review-caption">Recorded as reported by an organizer. Commons has not verified this with a vendor.</p> : null}
      <label>Date <span className="review-caption">Saved: {basePlan.startsOn ? planLocalTimeLabel(basePlan) : "No time set"} · {basePlan.timezone.replace(/_/g, " ")}</span><input type="date" value={plan.startsOn ?? ""} onChange={event => updatePlan("startsOn", event.target.value || null)} disabled={!pending || busy} /></label>
      <label>Start time <TimeInput value={plan.startsTime ?? ""} onChange={event => updatePlan("startsTime", event.target.value || null)} disabled={!pending || busy} /></label>
      <label>Plan note · visible to all travelers <span className="review-caption">Saved: {basePlan.note ?? "No note"}</span><textarea rows={3} maxLength={4000} value={plan.note ?? ""} onChange={event => updatePlan("note", event.target.value || null)} disabled={!pending || busy} /></label>
      {plan.contact ? <div className="workspace-trip-travelers"><label><input type="checkbox" checked={plan.contact.include} disabled={!pending || busy} onChange={event => setChanges(valueNow => valueNow.plan?.contact ? { ...valueNow, plan: { ...valueNow.plan, contact: { ...valueNow.plan.contact, include: event.target.checked } } } : valueNow)} /><span>Add to the plan note: {plan.contact.text} — travelers will see this</span></label><p className="review-caption">Not added unless you check this. It stays in this organizer conversation either way.</p></div> : null}
    </fieldset> : null}
  </div>;
  if (compactPlan && plan && proposal.state === "applied" && proposal.changes.plan) {
    const done = proposal.changes.plan;
    return <div className="workspace-plan-receipt" tabIndex={-1} ref={node => { if (node && focusReceipt.current) { focusReceipt.current = false; node.focus(); } }}>
      <p>{done.title} marked {done.status}{done.contact?.include ? " · contact added to plan note" : ""}{proposal.receipt?.planId ? <> · <Link href={proposal.receipt?.planId ? itemDetailPath(slug, "plan", proposal.receipt.planId) : commonsViewPath(slug, "plan")}>View plan</Link></> : null}</p>
      <span className="review-caption">Saved by {proposal.receipt?.appliedBy ?? "an organizer"}, as reported. Commons hasn’t checked with the vendor.</span>
    </div>;
  }
  if (compactPlan && plan && pending && !editing && proposal.version === 1) {
    const status = plan.status === "cancelled" ? "cancelled" : "confirmed", when = planShortTimeLabel(compactPlan), contact = plan.contact;
    return <section className="workspace-proposal workspace-trip-proposal workspace-plan-confirm" aria-labelledby={headingId}>
      <h3 id={headingId}>Mark “{compactPlan.title}”{when ? ` (${when})` : ""} {status}?</h3>
      <p className="review-caption">As reported by {reportedBy ?? "an organizer"}. Commons hasn’t checked with the vendor.</p>
      {contact ? <label className="workspace-plan-confirm-contact"><input type="checkbox" checked={includeContact} disabled={busy} onChange={event => setIncludeContact(event.target.checked)} /><span>Also add {contact.text} to the plan note (travelers see it)</span></label> : null}
      <div className="workspace-actions">
        <button type="button" className="cm-action cm-action--primary" disabled={busy || blocked || conflict} onClick={() => applyReviewed(contact ? { text: contact.text, include: includeContact } : undefined)}>{status === "cancelled" ? "Mark cancelled" : "Confirm"}</button>
        <button type="button" className="cm-action" disabled={busy || blocked || conflict} onClick={() => onAction(turnId, "dismiss_trip", proposal.version)}>Not now</button>
        <button type="button" className="workspace-topic" disabled={busy} onClick={() => setEditing(true)}>Edit details</button>
      </div>
    </section>;
  }
  // Commons' own follow-up to the apply (a booking brief, or why there isn't one) sits beneath the receipt and receives focus when it arrives with the apply.
  const followUp = proposal.preparation?.outcome ? <LodgingFollowUp preparation={proposal.preparation} appliedBy={proposal.receipt?.appliedBy ?? "An organizer"} focusRef={node => { if (node && focusReceipt.current) { focusReceipt.current = false; node.focus(); } }} /> : null;
  if (!pending) return <><details className="workspace-proposal workspace-proposal--resolved">
    <summary>{proposal.state === "applied" ? (proposal.operations.length === 1 && proposal.operations[0] === "plan" ? "Saved plan update" : "Saved trip update") : "Kept current trip"}</summary>
    <p className="review-caption">{proposal.state === "applied" ? `Saved by ${proposal.receipt?.appliedBy ?? "an organizer"}.` : "Nothing changed."}</p>
    {proposal.state === "applied" ? <><ul className="workspace-trip-receipt">
      {proposal.operations.includes("budget") ? <li>Target trip budget: {money(proposal.changes.budgetCents)}</li> : null}
      {proposal.operations.includes("dates") ? <li>Trip dates: {proposal.changes.startsOn ?? "Not set"} to {proposal.changes.endsOn ?? "Not set"}</li> : null}
      {proposal.operations.includes("destination") ? <li>Destination: {proposal.changes.locationName ?? "Not set"}</li> : null}
      {proposal.operations.includes("plan") && proposal.changes.plan ? <li>Plan: {proposal.changes.plan.title} · {PLAN_STATUS_LABEL[proposal.changes.plan.status]} · {planLocalTimeLabel(proposal.changes.plan)}{proposal.changes.plan.contact?.include ? " · contact added to the note" : ""}</li> : null}
      {proposal.operations.includes("stay") && proposal.changes.stay ? <li>Stay: {proposal.changes.stay.name}, {proposal.changes.stay.address} · {proposal.changes.stay.startsOn} to {proposal.changes.stay.endsOn} · {money(proposal.changes.stay.totalCents)} reported cost</li> : null}
    </ul><div className="workspace-actions"><Link href={commonsViewPath(slug, "home")}>View trip details</Link>{proposal.receipt?.stayId ? <Link href={itemDetailPath(slug, "stay", proposal.receipt!.stayId!)}>View lodging</Link> : null}{proposal.receipt?.planId ? <Link href={proposal.receipt?.planId ? itemDetailPath(slug, "plan", proposal.receipt.planId) : commonsViewPath(slug, "plan")}>View plan</Link> : null}</div></> : null}
  </details>{followUp}</>;
  return <section className="workspace-proposal workspace-trip-proposal">
    <span className="view-kicker">{proposal.operations.length === 1 && proposal.operations[0] === "plan" ? "Suggested plan update" : "Suggested trip update"}</span><h3>{proposal.operations.length === 1 && proposal.operations[0] === "plan" ? "Review changes to this plan" : "Review changes to this trip"}</h3>
    <p className="review-caption">Not saved · From {proposal.source}. Active organizers can see the saved trip records. Nothing changes until an organizer applies this review.</p>
    {proposal.operations.includes("dates") ? <p className="review-caption">Changing trip dates will not move travel plans, activities, or other stays. Review those separately.</p> : null}
    {fields}
    {invalidMoney ? <p role="alert" className="review-caption">Use a valid USD amount with at most two decimal places.</p> : null}
    <div className="workspace-actions">
      {dirty ? <button type="button" className="cm-action cm-action--primary" disabled={busy || blocked || conflict || invalidMoney || planIncomplete} onClick={() => onAction(turnId, "revise_trip", proposal.version, changes)}>Save review edits</button>
        : <button type="button" className="cm-action cm-action--primary" disabled={busy || blocked || conflict || invalidMoney || planIncomplete || (proposal.operations.includes("stay") && !changes.includedPersonIds.length)} onClick={() => applyReviewed()}>Apply changes</button>}
      <button type="button" className="cm-action" disabled={busy || blocked || conflict} onClick={() => onAction(turnId, "dismiss_trip", proposal.version)}>Keep current</button>
    </div>{dirty ? <p className="review-caption">Save these edits to the review before applying.</p> : null}
  </section>;
}

export function CoordinatorWorkspace({ activityDecisionsEnabled = false, dynamicUiEnabled = false, compareStaysRenderer = "openui", compareStaysEnabled = false, recipesEnabled = false, assistantUiEnabled = false, portabilityEnabled = false, taskContext, coordinatorPreferences, actorId, slug, eventName, initialThread, initialRecommendations, initialDraftId, initialPollId, initialItineraryId, conversationAvailable, voiceAvailable = false, researchAvailable = false, durableResearchAvailable = false, actorName = "Organizer", startQuestion = false, startNew = false, startVoice = false, tripFacts = {}, tripIdeas = [], prototypeInspector = false, prototypePublishedPollId, continuity, goalsEnabled = false, brainEnabled = false, initialGoals = { goals: [], reports: [] }, voiceReady = false, runnerOperating = false, entryNotice, embedded = false, active = true, overview, showOverview = false, onActivate, navigation, mainThread, onAddRecord, layout = "legacy" }: {
  /** Guided recipes (docs/RECIPE-LIFECYCLE-OVERNIGHT-PLAN.md) are available to this trip. Off by default. */
  /** Paired local evaluation seam; no permission or data scope changes. */
  activityDecisionsEnabled?: boolean;
  dynamicUiEnabled?: boolean;
  compareStaysRenderer?: "react" | "openui";
  compareStaysEnabled?: boolean;
  recipesEnabled?: boolean;
  assistantUiEnabled?: boolean;
  /** Itinerary Markdown export and reviewed re-import (COMMONS_ITINERARY_PORTABILITY_ENABLED). Off by default. */
  portabilityEnabled?: boolean;
  /**
   * `persistent` is the persistent-rail presentation (Work left, conversation right, Conversations selector, Tasks in Work). The shell owns the main landmark
   * and the height. `legacy` (default) is the previous three-region layout, unchanged, so the flag can be turned off.
   */
  layout?: "legacy" | "persistent";
  embedded?: boolean; active?: boolean; overview?: ReactNode | ((context: { goals: GoalWorkspaceState["goals"]; legacyTasks: import("@commons/contracts").CoordinatorTask[]; tasksUnavailable: boolean; tasksLoading: boolean; openTask: (threadId: string) => void; openTodo:(id:string)=>void }) => ReactNode); showOverview?: boolean; onActivate?: () => void;
  navigation?: { selected: string; revision: number; intent?: "import" }; mainThread?: CoordinatorThread;
  goalsEnabled?: boolean; brainEnabled?: boolean; initialGoals?: GoalWorkspaceState;
  onAddRecord?: (kind: CoordinatorAddKind) => void;
  taskContext?: TripTaskContext;
  actorId?: string; coordinatorPreferences?: {settings:{version:number;personality:{id:CoordinatorPersonalityId;specificationVersion:1}};dismissed:boolean};
  slug: string; eventName: string; initialThread: CoordinatorThread; initialRecommendations: CoordinatorRecommendation[];
  initialDraftId?: string; initialPollId?:string; initialItineraryId?: string; conversationAvailable: boolean; voiceAvailable?: boolean; researchAvailable?: boolean; durableResearchAvailable?: boolean; actorName?: string;
  /** Open on the explicit Ask the group starter. */
  startQuestion?: boolean;
  /** Open on an ordinary new conversation (the Home entry). */
  startNew?: boolean;
  /** Open the voice dialog ready to start; the microphone stays off until the organizer taps Start. */
  startVoice?: boolean;
  tripFacts?: CoordinatorStarterFacts; tripIdeas?: TripIdea[]; prototypeInspector?: boolean; prototypePublishedPollId?: string;
  /** Present only while COMMONS_COORDINATOR_STEERING_ENABLED is on: the main conversation, how threads relate, and what tasks can do here. */
  continuity?: { mainThreadId: string; capability: TaskCapability; relations: Array<ThreadRelation & { threadId: string }> };
  /** Open the voice dialog ready on the current (main) conversation; the microphone stays off until the organizer taps Start. */
  voiceReady?: boolean;
  /** A task runner is declared operating (COMMONS_COORDINATOR_TASK_RUNNER=active). Only then may copy say research continues after leaving. */
  runnerOperating?: boolean;
  /** Shown once on entry, e.g. when a linked conversation was unavailable and the main one opened instead. */
  entryNotice?: string;
}) {
  const router = useRouter();
  const [personality,setPersonality]=useState<CoordinatorPersonalityId>(coordinatorPreferences?.settings.personality.id??'commons');
  const [invitationDismissed,setInvitationDismissed]=useState(coordinatorPreferences?.dismissed??true);
  const coordinatorName=coordinatorPersonalities.find(p=>p.id===personality)!.name;
  const [thread, setThreadState] = useState(initialThread);
  const [attachmentStates, setAttachmentStates] = useState<Record<string, { refs: NonNullable<TurnCommand["attachments"]>; blocked: boolean }>>({});
  const [clearedAttachments, setClearedAttachments] = useState<Record<string, string[]>>({});
  const threadCache = useRef(new Map([...(mainThread?.activeThreadId ? [[mainThread.activeThreadId, mainThread] as const] : []), ...(initialThread.activeThreadId ? [[initialThread.activeThreadId, initialThread] as const] : [])]));
  // Every visible record mutation must also survive mounted navigation/history restoration.
  const setThread = useCallback((update: CoordinatorThread | ((value: CoordinatorThread) => CoordinatorThread)) => {
    setThreadState(value => {
      const next = typeof update === "function" ? update(value) : update;
      if (next.activeThreadId) threadCache.current.set(next.activeThreadId, next);
      return next;
    });
  }, []);
  const goalController = useGoalWorkspace(slug, actorId, goalsEnabled, initialGoals);
  const legacyOverview = useOverviewLegacyTasks(slug, thread.threads.map(item => item.id), Boolean(showOverview && !goalsEnabled && continuity?.capability.steering));
  const [selected, setSelected] = useCoordinatorContext(slug, thread, initialDraftId, initialPollId, initialItineraryId, actorId);
  const initiallyUnfocused = defaultWorkspaceContext(initialThread, initialDraftId, initialPollId) === "new";
  const persistent = layout === "persistent";
  // `tasks` is the old Trip board / Tasks list (the legacy layout's `data-pane="plan"`); it is not the canonical Plan. In the persistent layout it opens in Work on demand.
  const [pane, setPane] = useState<"tasks" | "conversation" | "work">(persistent ? (initialPollId || initialItineraryId || initialDraftId ? "work" : "conversation") : initialPollId || initialItineraryId ? "work" : startQuestion || startNew || startVoice || initiallyUnfocused || initialDraftId || initialThread.activeThreadId ? "conversation" : "tasks");
  /** What a closed Work falls back to: the legacy layout shows the board, the persistent layout keeps the conversation. */
  const idlePane = persistent ? "conversation" as const : "tasks" as const;
  const [boardCollapsed, setBoardCollapsed] = useState(false);
  // Working material temporarily borrows the navigation rail’s space.
  // Keep the organizer’s stored navigation preference for when it closes.
  const navigationCollapsed = boardCollapsed || pane === "work";
  const [workCollapsed, setWorkCollapsed] = useState(false);
  const workDismissal = useRef(0);
  // Persistent layout presentation only: Work fills the content area, whether two surfaces fit side by side, and Work's share of the width.
  const [expanded, setExpanded] = useState(false);
  const [splitFits, setSplitFits] = useState(false);
  const [workRatio, setWorkRatio] = useState(DEFAULT_WORK_RATIO);
  const [presentationReady, setPresentationReady] = useState(!persistent);
  const workOpen = persistent && pane !== "conversation" && !showOverview;
  const mode = surfaceMode({ workOpen, expanded, fits: splitFits });
  const conversationVisible = !persistent || (mode !== "full" && mode !== "work" && !showOverview);
  const conversationShown = useRef(true);
  const retainedTop = useRef(0);
  const tasksScroll = useRef<HTMLDivElement>(null);
  const materialScroll = useRef<HTMLDivElement>(null);
  const tasksToggle = useRef<HTMLButtonElement>(null);
  const getTasksScroll = useCallback(() => tasksScroll.current, []), getMaterialScroll = useCallback(() => materialScroll.current, []);
  useRetainedScroll(getTasksScroll, workOpen && pane === "tasks");
  useRetainedScroll(getMaterialScroll, workOpen && pane === "work");
  useEffect(() => { if (!selected.startsWith("research:")) return; const frame = requestAnimationFrame(() => setPane("work")); return () => cancelAnimationFrame(frame); }, [selected]);
  const pollResultOrigins = useRef(new Map<string, { selection: string; dismissal: number }>());
  const workToggle = useRef<HTMLButtonElement>(null);
  const [showItineraryResults, setShowItineraryResults] = useState(Boolean(initialPollId));
  const [itineraryProposalId, setItineraryProposalId] = useState<string | null>(null);
  const [reviewedItineraryProposalId, setReviewedItineraryProposalId] = useState<string | null>(null);
  const [dynamicUiThread, setDynamicUiThread] = useState<string | null>(null);
  const [stayComparisonThread, setStayComparisonThread] = useState<string | null>(null);
  const [checkInRequested, setCheckInRequested] = useState(false);
  const [itineraryImport, setItineraryImport] = useState<{draftId:string;source:string;destination:UnsentDestination;token:string;actorId?:string}|null>(null);
  const itineraryStart = useRef<{threadId:string;draftId:string;commandId:string}|null>(null);
  // New thread is an ordinary conversation. Ask the group is the separate, explicit poll workflow.
  const [startingQuestion, setStartingQuestion] = useState(startQuestion);
  const [starterId, setStarterId] = useState<CoordinatorStarterId | null>(null);
  const [startingThread, setStartingThread] = useState(!startQuestion && (startNew || startVoice || initiallyUnfocused));
  // Latest navigation state for async work (results, recovery, voice): a callback must never act on the render it was created in.
  const view = useRef<{ selected: string; startingQuestion: boolean; startingThread: boolean; starterId: CoordinatorStarterId | null }>({ selected, startingQuestion, startingThread: !startQuestion && (startNew || startVoice || initiallyUnfocused), starterId: null });
  const threadRef = useRef(thread);
  // Flags a spoken request must see as they are now, not as they were when the voice session started.
  const [addPickerOpen, setAddPickerOpen] = useState(false);
  const [commandIndex, setCommandIndex] = useState(0);
  const [commandDismissed, setCommandDismissed] = useState<string | null>(null);
  const latestUi = useRef({ busy: false, blocked: false, conflict: false, conversationAvailable, researchAvailable, researchQuery: "" });
  useEffect(() => { view.current.selected = selected; }, [selected]);
  useEffect(() => { threadRef.current = thread; }, [thread]);
  const newThreadId = useRef<string | null>(null);
  /** The first command sent to the current `new` thread id: what to look up if a later, edited send is told that thread already exists. */
  const firstNewCommand = useRef<TurnCommand | null>(null);
  const [notice, setNotice] = useState(entryNotice ?? "");
  // Suggested to-dos (same list, targets and permissions as Tasks), offered as next steps under the newest reply.
  const [nextSteps, setNextSteps] = useState<ThingToDo[]>([]);
  const draftScope = JSON.stringify([slug, actorId ?? null]);
  const [scopedDrafts, setScopedDrafts] = useState<Record<string, Record<string, string>>>({});
  const drafts = scopedDrafts[draftScope] ?? {};
  const effectiveSelected = startingThread || startingQuestion && !workspaceThreadId(selected, thread) ? "new" : selected;
  const destination = unsentDestinationFor({ startingQuestion, startingThread, selected }, workspaceThreadId(selected, thread));
  const prompt = drafts[destination] ?? "";
  const attachmentScope = `${draftScope}:${destination}`;
  const sourceState = attachmentStates[attachmentScope];
  const canAttachSources = assistantUiEnabled && (destination === "new" || destination === "ask" || destination.startsWith("thread:") || destination.startsWith("draft:") && Boolean(workspaceThreadId(destination, thread)));
  const onSourcesChanged = useCallback((refs: NonNullable<TurnCommand["attachments"]>, blocked: boolean) => {
    setAttachmentStates(value => ({ ...value, [attachmentScope]: { refs, blocked } }));
  }, [attachmentScope]);
  useEffect(() => {
    // Restore after the first frame so the server and client render the same markup; text typed meanwhile is never overwritten.
    const frame = requestAnimationFrame(() => setScopedDrafts(value => {
      const own = value[draftScope] ?? {};
      return destination in own ? value : { ...value, [draftScope]: { ...own, [destination]: actorId ? readUnsent(slug, actorId, destination) : "" } };
    }));
    return () => cancelAnimationFrame(frame);
  }, [destination, slug, actorId, draftScope]);
  function setPromptFor(target: UnsentDestination, text: string) {
    setScopedDrafts(value => ({ ...value, [draftScope]: { ...value[draftScope], [target]: text } }));
    if (actorId) writeUnsent(slug, actorId, target, text);
  }
  const hasUnsent = Object.values(drafts).some(value => value.trim());
  const [researchQuery, setResearchQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState<{ threadId: string; title: string; source: "text" | "voice" } | null>(null);
  const working = busy || sending !== null;
  const [draftBlocked, setBlocked] = useState(false);
  const [itineraryDirty, setItineraryDirty] = useState(false);
  // A returned Commons export goes to import review in Work, never to the model as a message.
  const [portabilitySeed, setPortabilitySeed] = useState<{ text: string; token: string } | null>(null), [importOpen, setImportOpen] = useState(false);
  const blocked = draftBlocked;
  const itineraryFlush = useRef<(() => Promise<DocumentState>) | null>(null);
  const legacyItineraryFlush = useRef<(() => Promise<void>) | null>(null);
  const [failure, setFailure] = useState<CoordinatorFailure | null>(null);
  const [unconfirmed, setUnconfirmed] = useState<TurnCommand | null>(null);
  const [conflict, setConflict] = useState(false);
  /**
   * The reply streaming in this browser, shown in its origin thread until the saved turn replaces it. `origin` is the thread id the command was sent
   * to; `detached` means the organizer left the new conversation it was started from, so it waits in its thread instead of showing elsewhere.
   */
  const [live, setLive] = useState<(LiveTurnView & { origin: string; originKind: "new" | "existing"; turnId: string | null; detached: boolean }) | null>(null);
  /** Commands this organizer stopped in this browser, so their failed record says "You stopped this reply" rather than a provider failure. */
  const [stoppedCommands, setStoppedCommands] = useState<ReadonlySet<string>>(() => new Set());
  const [showJump, setShowJump] = useState(false);
  useEffect(() => {
    // After the first frame, so the server and client render the same markup.
    if (!actorId) return;
    const frame = requestAnimationFrame(() => setStoppedCommands(new Set(loadStoppedCommands(slug, actorId))));
    return () => cancelAnimationFrame(frame);
  }, [slug, actorId]);
  /** The conversation follows new content only while the organizer is reading the bottom of it. */
  const pinned = useRef(true);
  /** Commands the organizer asked to stop, read by async work that outlives the render it started in. */
  const stopAsked = useRef(new Set<string>());
  useEffect(() => { latestUi.current = { busy, blocked, conflict, conversationAvailable, researchAvailable, researchQuery }; });
  useEffect(() => { latestPrompt.current = { prompt, dest: destination }; });
  const [revision, setRevision] = useState(0);
  // Continuity (steering on): relations between threads, outcomes linked into the main conversation, the one queued follow-up, and the subthread form.
  const [relations, setRelations] = useState(continuity?.relations ?? []);
  const [outcomes, setOutcomes] = useState<ThreadOutcome[]>([]);
  const [queued, setQueued] = useState(false);
  const [subthreadOpen, setSubthreadOpen] = useState(false);
  const queuedNext = useRef<{ dest: UnsentDestination } | null>(null);
  const replying = useRef(false);
  const latestPrompt = useRef({ prompt: "", dest: "new" as UnsentDestination });
  const queuedTextSend = useRef<(text: string) => void>(() => {});
  const [taskRuns, setTaskRuns] = useState<{ current: ReadonlySet<string>; all: ReadonlySet<string> }>({ current: new Set(), all: new Set() });
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [trackedTasks, setTrackedTasks] = useState<string[]>(["fare"]);
  const inFlight = useRef(false);
  const abort = useRef<AbortController | null>(null);
  // Same text to the same place keeps its command id, so a resend after a rejected or unconfirmed send reuses it.
  const commandIds = useRef(new Map<string, string>());
  const turnVersions = useRef(new Map<string, number>());
  const watching = useRef(new Set<string>());
  const alive = useRef(true);
  const pendingTripCommands = useRef(new Map<string, { id: string; body: string }>());
  const messages = useRef<HTMLDivElement>(null);
  const draftDetails = useRef<HTMLElement>(null);
  const historyAnchor = useRef<{ height: number; top: number } | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const scrollPositions = useRef(new Map<string, number>());
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (startQuestion || startNew || startVoice) composer.current?.focus(); }, [startQuestion, startNew, startVoice]);
  useEffect(() => {
    // Turn versions only move forward: a payload fetched before a result can arrive after it.
    if (thread.activeThreadId) turnVersions.current.set(thread.activeThreadId, Math.max(turnVersions.current.get(thread.activeThreadId) ?? 0, thread.version));
  }, [thread.activeThreadId, thread.version]);
  useEffect(() => {
    if (persistent) return;
    const frame = window.requestAnimationFrame(() => {
      setBoardCollapsed(window.localStorage.getItem(`commons:${slug}:workspace-board`) === "collapsed");
      setWorkCollapsed(window.localStorage.getItem(`commons:${slug}:workspace-work`) === "collapsed");
    });
    return () => window.cancelAnimationFrame(frame);
  }, [slug, continuity, embedded, persistent]);
  useEffect(() => {
    // After the first frame so the server and client render the same markup. Restores only presentation: width, and the Work surface/expansion kept in history.state.
    if (!persistent) return;
    const frame = requestAnimationFrame(() => {
      setWorkRatio(readRatio(slug, actorId));
      const saved = readWorkspaceHistory(window.history.state);
      if (saved) { if (saved.surface === "conversation") workDismissal.current += 1; setPane(saved.surface); setExpanded(saved.expanded); }
      else if (new URLSearchParams(window.location.search).get("todo")) setPane("tasks");
      setPresentationReady(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [persistent, slug, actorId]);
  // Replaced, never pushed: width, expansion and Work visibility add no history entries and keep the framework's own fields.
  useEffect(() => { if (persistent && presentationReady) persistWorkspaceHistory({ surface: pane, expanded }); }, [persistent, presentationReady, pane, expanded]);
  useEffect(() => { if (prototypePublishedPollId) setSelected(`poll:${prototypePublishedPollId}`); }, [prototypePublishedPollId, setSelected]);
  const lastTurnId = thread.turns.at(-1)?.id;
  const previousLastTurnId = useRef(lastTurnId);
  const firstTurnId = thread.turns[0]?.id;
  useLayoutEffect(() => {
    // The persistent layout can scroll the whole conversation slot on short screens, so anchor on whatever really scrolls there.
    const scroller = persistent ? conversationScroller() : messages.current;
    if (scroller && historyAnchor.current) {
      scroller.scrollTop = historyAnchor.current.top + scroller.scrollHeight - historyAnchor.current.height;
      historyAnchor.current = null;
    }
  }, [firstTurnId]); // eslint-disable-line react-hooks/exhaustive-deps -- reads refs and the DOM only
  /** What actually scrolls the conversation: its own region on roomy layouts, the page on short or narrow ones (where the region does not scroll). */
  function conversationScroller(): HTMLElement | null {
    const box = messages.current;
    if (!box) return null;
    if (/auto|scroll/.test(getComputedStyle(box).overflowY)) return box;
    // Persistent layout: on short screens the conversation slot scrolls as a whole (the composer stays reachable) instead of the message list.
    if (persistent) { const slot = box.closest<HTMLElement>(".workspace-pane-slot--conversation"); if (slot && /auto|scroll/.test(getComputedStyle(slot).overflowY)) return slot; }
    return document.scrollingElement as HTMLElement | null;
  }
  function atBottom(element: HTMLElement) { return element.scrollHeight - element.scrollTop - element.clientHeight < 64; }
  function scrollToLatest() {
    pinned.current = true; setShowJump(false);
    const scroller = conversationScroller();
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }
  /** New content below: follow it only if the organizer was at the bottom; otherwise keep their place and offer Jump to latest. */
  function followNewContent() {
    const scroller = conversationScroller();
    if (!scroller) return;
    if (pinned.current) scroller.scrollTop = scroller.scrollHeight; else setShowJump(true);
  }
  useEffect(() => {
    // Where the page scrolls instead of the conversation region, reading position comes from the page.
    const onScroll = () => { const scroller = conversationScroller(); if (!scroller || scroller === messages.current) return; retainedTop.current = scroller.scrollTop; pinned.current = atBottom(scroller); if (pinned.current) setShowJump(false); };
    window.addEventListener("scroll", onScroll, { passive: true });
    const slot = persistent ? messages.current?.closest<HTMLElement>(".workspace-pane-slot--conversation") : null;
    slot?.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); slot?.removeEventListener("scroll", onScroll); };
  }, [persistent]); // eslint-disable-line react-hooks/exhaustive-deps -- conversationScroller reads refs and the DOM only
  // The conversation is hidden (not unmounted) while Work has the whole area; coming back restores where the reader was, or the latest message if they were following it.
  useLayoutEffect(() => {
    if (!persistent) return;
    if (conversationVisible && !conversationShown.current) { const scroller = conversationScroller(); if (scroller) scroller.scrollTop = pinned.current ? scroller.scrollHeight : retainedTop.current; }
    conversationShown.current = conversationVisible;
  }, [persistent, conversationVisible]); // eslint-disable-line react-hooks/exhaustive-deps -- conversationScroller reads refs and the DOM only
  useEffect(() => {
    if (previousLastTurnId.current !== lastTurnId) followNewContent();
    previousLastTurnId.current = lastTurnId;
  }, [lastTurnId]); // eslint-disable-line react-hooks/exhaustive-deps -- followNewContent reads refs and the DOM only
  useEffect(() => { if (live) followNewContent(); }, [live?.text, live?.phase, live?.commandId]); // eslint-disable-line react-hooks/exhaustive-deps -- follows the live reply only
  // Opening a place starts at its latest message. Scrolling fires onScroll, which clears Jump to latest.
  useEffect(() => { if (persistent && !conversationShown.current) return; const scroller = conversationScroller(); if (scroller) { scroller.scrollTop = scrollPositions.current.get(selected) ?? scroller.scrollHeight; pinned.current = atBottom(scroller); } }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps -- a hidden conversation keeps its place; it is restored when shown
  const endpoint = coordinatorEndpoint(slug);
  const threadsEndpoint = `${endpoint}/threads`;
  const selectedThreadId = workspaceThreadId(effectiveSelected, thread);
  const selectedThread = thread.threads.find(item => item.id === selectedThreadId);
  const mainThreadId = continuity?.mainThreadId ?? null;
  const relationOf = (id: string | undefined) => (id ? relations.find(item => item.threadId === id) ?? (id === mainThreadId ? { threadId: id, kind: "main" as const, parentThreadId: null, brief: null, briefTaskIds: [] } : null) : null);
  const selectedRelation = relationOf(selectedThreadId);
  const parentOfSelected = selectedRelation?.parentThreadId ? thread.threads.find(item => item.id === selectedRelation.parentThreadId) : undefined;
  const editable = thread.drafts.filter(draft => !draft.publishedPollId && !draft.archivedAt);
  const goalDraft = selectedThreadId ? thread.drafts.filter(draft => draft.threadId === selectedThreadId && !draft.archivedAt).at(-1) : undefined;
  const goalPoll = selectedThreadId ? thread.polls.filter(poll => poll.threadId === selectedThreadId && !poll.archivedAt).at(-1) : undefined;
  const current = workspaceEditableDraft(effectiveSelected, thread);
  const selectedPollId = effectiveSelected.startsWith("poll:") ? effectiveSelected.slice(5) : effectiveSelected.startsWith("thread:") ? goalPoll?.id ?? goalDraft?.publishedPollId ?? undefined : undefined;
  const contextTitle = selectedThreadId === mainThreadId ? "Coordinator" : startingQuestion ? starterId ? coordinatorStarter(starterId).label : "Ask the group" : startingThread ? "New conversation" : workspaceContextTitle(selected, thread);
  const contextTurns = startingThread ? [] : workspaceContextTurns(effectiveSelected, thread).reverse();
  const itineraryTurn = contextTurns.findLast(turn => turn.workspace?.itineraryDraft);
  const selectedProjection = thread.drafts.find(draft => effectiveSelected === `draft:${draft.id}`);
  const projectionDocumentId = selectedProjection?.data.privateItineraryDocument?.id ?? thread.turns.findLast(turn => turn.workspace?.itineraryDraft?.sharingDraft?.draftId === selectedProjection?.id && Boolean(selectedProjection))?.workspace?.itineraryDraft?.id;
  const selectedDocumentId = (effectiveSelected.startsWith("itinerary:") ? effectiveSelected.slice(10) : undefined) ?? projectionDocumentId;
  const reviewedItineraryTurn = (selectedDocumentId ? thread.turns.findLast(turn => turn.threadId === selectedThreadId && turn.workspace?.itineraryDraft?.id === selectedDocumentId) : null) ?? itineraryTurn;
  const selectedPoll = thread.polls.find(poll => poll.id === selectedPollId);
  const artifact = startingQuestion ? null : current ?? thread.drafts.find(draft => draft.publishedPollId === selectedPollId);
  const selectedResearchTurn = effectiveSelected.startsWith("research:") ? contextTurns.find(turn => turn.id === effectiveSelected.slice(9) && turn.workspace?.research) : undefined;
  const showPreparedItinerary = Boolean(!selectedResearchTurn && reviewedItineraryTurn && (projectionDocumentId || !effectiveSelected.startsWith("draft:") && !effectiveSelected.startsWith("poll:")));
  const itinerary = artifact && itineraryQuestion(artifact.data.questions);
  const itineraryProposals = artifact && !artifact.publishedPollId ? contextTurns.filter(turn => turn.draftId === artifact.id && turn.workspace?.proposal?.state === "pending" && turn.workspace.proposal.baseVersion === artifact.version && itineraryQuestion(turn.workspace.proposal.data.questions)) : [];
  const itineraryProposalTurn = itineraryProposals.find(turn => turn.id === itineraryProposalId) ?? itineraryProposals.at(-1);
  const itineraryProposal = itineraryProposalTurn?.workspace?.proposal;
  const researchTurns = contextTurns.filter(turn => turn.workspace?.research);
  const legacyResearchTurns = selectedThreadId ? [] : researchTurns;
  const researchRuns = selectedThreadId ? thread.researchRuns.filter(run => run.threadId === selectedThreadId) : [];
  const linkedIdeas = selectedThreadId ? thread.linkedIdeas.filter(idea => idea.threadId === selectedThreadId) : [];
  const availableIdeas = tripIdeas.filter(idea => idea.status === "idea" && !thread.linkedIdeas.some(link => link.itineraryItemId === idea.id));
  const canCompareStays = compareStaysEnabled && Boolean(taskContext?.organizer && actorId && selectedThreadId);
  const comparingStays = canCompareStays && stayComparisonThread === selectedThreadId;
  const latestUiTurn = contextTurns.findLast(turn => turn.status === undefined || turn.status === "completed");
  const dynamicPresentation = dynamicUiEnabled && taskContext?.organizer && selectedThreadId ? latestUiTurn?.workspace?.presentation : undefined;
  const dynamicCatalog = dynamicPresentation && taskContext && selectedThreadId && latestUiTurn ? presentationCatalog({ commons: taskContext.commons, stays: taskContext.state.stays ?? [], itinerary: taskContext.state.itinerary, thread, threadId: selectedThreadId, beforeTurnId: latestUiTurn.id }) : null;
  const showingDynamic = Boolean(dynamicPresentation && dynamicCatalog && actorId && dynamicUiThread === selectedThreadId);
  const hasWork = Boolean(dynamicPresentation || comparingStays || selectedThread || artifact || selectedPoll || researchTurns.length || researchRuns.length || linkedIdeas.length || initialRecommendations.some(item => item.sourcePollId === selectedPollId));
  const saved = useCallback((draft: PollWorkingDraft) => { const next = { ...threadRef.current, drafts: threadRef.current.drafts.map(item => item.id === draft.id ? { ...item, ...draft } : item) }; threadRef.current = next; setThread(next); }, [setThread]);
  useEffect(() => {
    // Typed text is kept per place in session storage, so only a send in progress (or text that cannot be stored) needs a warning.
    const guard = (event: BeforeUnloadEvent) => { if (inFlight.current || itineraryDirty || ((hasUnsent || researchQuery.trim()) && !actorId)) event.preventDefault(); };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [hasUnsent, researchQuery, actorId, itineraryDirty]);
  /** After async work: a result that arrives once the page is gone has nothing to focus. */
  function focusComposer() { if (alive.current) requestAnimationFrame(() => composer.current?.focus()); }
  function setError(message: string) { setFailure(message ? { message, code: null } : null); }
  /** Shows a failure with its stable code. Only a stale saved state asks for a reload; other codes say what they are. */
  function showFailure(cause: unknown, fallback: string) {
    if (cause instanceof CoordinatorRequestError && cause.status === 409 && (cause.code === "stale_version" || cause.code === "internal_error")) setConflict(true);
    setFailure(failureFrom(cause, fallback));
  }
  /** Everything after `selected` is committed synchronously to the ref, so results and voice read the latest place. */
  function go(patch: Partial<{ selected: string; startingQuestion: boolean; startingThread: boolean; starterId: CoordinatorStarterId | null }>) {
    if (patch.selected !== undefined && patch.selected !== view.current.selected) {
      const scroller = conversationScroller();
      if (scroller) scrollPositions.current.set(view.current.selected, persistent && !conversationShown.current ? retainedTop.current : scroller.scrollTop);
    }
    Object.assign(view.current, patch);
    if (patch.selected !== undefined) setSelected(patch.selected);
    if (patch.startingQuestion !== undefined) setStartingQuestion(patch.startingQuestion);
    if (patch.startingThread !== undefined) setStartingThread(patch.startingThread);
    if (patch.starterId !== undefined) setStarterId(patch.starterId);
  }
  function writeLocation(threadId?: string, selection = view.current.selected) {
    const url = new URL(embedded ? commonsViewPath(slug, "coordinator") : `/c/${slug}/coordinator/`, window.location.origin ?? "http://localhost");
    const ownerThreadId = threadId ?? workspaceThreadId(selection, threadRef.current);
    if (ownerThreadId) url.searchParams.set("thread", ownerThreadId);
    if (selection.startsWith("research:")) url.searchParams.set("research", selection.slice(9));
    else if (selection.startsWith("poll:")) url.searchParams.set("poll", selection.slice(5));
    else if (selection.startsWith("itinerary:")) url.searchParams.set("itinerary", selection.slice(10));
    else if (selection.startsWith("draft:")) url.searchParams.set("draft", selection.slice(6));
    else if (view.current.startingQuestion) url.searchParams.set("ask", "1");
    else if (view.current.startingThread) url.searchParams.set("new", "1");
    else if (selection.startsWith("thread:")) url.searchParams.set("thread", selection.slice(7));
    const path = url.pathname + url.search;
    if (window.location.pathname + window.location.search !== path) {
      if (embedded) window.history.pushState(null, "", path);
      else window.history.replaceState(null, "", path);
    }
  }
  useEffect(() => {
    if (!navigation) return;
    const value = navigation.selected;
    const frame = requestAnimationFrame(() => {
      if (value === view.current.selected) return;
      if (persistent && value === "tasks") { onActivate?.(); setPane("tasks"); return; }
      setPane(value.startsWith("itinerary:") || value.startsWith("research:") || persistent && (value.startsWith("poll:") || value.startsWith("draft:")) ? "work" : "conversation");
      if (value === "overview") return;
      const cached = value.startsWith("thread:") ? threadCache.current.get(value.slice(7)) : null;
      if (cached) setThread(cached);
      go({selected: value, startingQuestion: value === "ask", startingThread: value === "new", starterId: null});
      if (actorId) setScopedDrafts(current => ({ ...current, [draftScope]: { ...current[draftScope], [value]: readUnsent(slug, actorId, value as UnsentDestination) } }));
      composer.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
    // Explicit navigation is captured by its revision, not by async thread updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation?.revision]);
  function merge(next: CoordinatorThread) {
    // A flushed save must be available to the next chat command before React renders.
    threadRef.current = next;
    setThread(value => {
      const merged = value.activeThreadId !== next.activeThreadId ? next : ({ ...next, turns: [...value.turns.filter(turn => !next.turns.some(item => item.id === turn.id)), ...next.turns], hasEarlier: value.hasEarlier });
      if (merged.activeThreadId) threadCache.current.set(merged.activeThreadId, merged);
      return merged;
    });
  }
  function leaveRemovedContext(next: CoordinatorThread) {
    const fallback = defaultWorkspaceContext(next);
    newThreadId.current = null; firstNewCommand.current = null;
    go({ selected: fallback, startingQuestion: false, startingThread: fallback === "new", starterId: null });
    setPane(fallback === "new" ? "conversation" : idlePane);
    writeLocation();
  }
  async function reload() {
    // Refresh what is on screen: without a resolved selection, the bare endpoint would return the newest conversation instead.
    const shownThreadId = selectedThreadId ?? threadRef.current.activeThreadId;
    const next = CoordinatorThreadSchema.parse(await requestJson(shownThreadId ? `${endpoint}?threadId=${encodeURIComponent(shownThreadId)}` : endpoint, { cache: "no-store" }));
    merge(next);
    setRevision(value => value + 1);
  }
  async function startItinerary(source?: string) {
    const importSource = source ? {source, destination, actorId, token:crypto.randomUUID()} : null;
    if (source && artifact?.publishedPollId) { setError("Start a revised itinerary before importing a replacement. The shared version is unchanged."); return; }
    if (source && artifact && itinerary) {
      setItineraryImport({draftId:artifact.id,...importSource!});
      if (actorId) rememberItineraryPaste(slug,actorId,artifact.id,destination,source);
      setShowItineraryResults(false); setWorkCollapsed(false); setPane("work");
      return;
    }
    setBusy(true); setError("");
    itineraryStart.current ??= {threadId:selectedThreadId ?? crypto.randomUUID(),draftId:crypto.randomUUID(),commandId:crypto.randomUUID()};
    const pending = itineraryStart.current;
    try {
      if (!selectedThreadId) await requestJson(threadsEndpoint, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:pending.threadId,commandId:pending.commandId,title:"Build our itinerary"})});
      const payload = await requestJson(`${endpoint}/drafts`, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:pending.draftId,threadId:pending.threadId,kind:"itinerary",prompt:"Work on our itinerary"})}) as {draft:unknown};
      const started = PollWorkingDraftSchema.parse(payload.draft);
      if (importSource) { setItineraryImport({draftId:started.id,...importSource}); if (actorId) rememberItineraryPaste(slug,actorId,started.id,importSource.destination,importSource.source); }
      merge(await loadThread(pending.threadId));
      go({selected:`thread:${pending.threadId}`,startingQuestion:false,startingThread:false,starterId:null});
      writeLocation(pending.threadId, `thread:${pending.threadId}`);
      setShowItineraryResults(false); setWorkCollapsed(false); setPane("work"); itineraryStart.current=null;
    } catch(cause) {showFailure(cause,"The itinerary couldn’t start. Try again.");}
    finally {setBusy(false);}
  }
  async function loadThread(threadId: string) {
    const next = CoordinatorThreadSchema.parse(await requestJson(`${endpoint}?threadId=${encodeURIComponent(threadId)}`, { cache: "no-store" }));
    turnVersions.current.set(threadId, Math.max(turnVersions.current.get(threadId) ?? 0, next.version));
    threadCache.current.set(threadId, next);
    return next;
  }
  /** New threads and navigation results appear on the Trip board without touching the conversation being read. */
  async function refreshBoard() {
    const next = CoordinatorThreadSchema.parse(await requestJson(endpoint, { cache: "no-store" }));
    if (alive.current) setThread(value => ({ ...value, threads: next.threads }));
  }
  function activateConversation() {
    onActivate?.();
    writeLocation();
  }
  function openResearch(turnId: string) {
    const selection = `research:${turnId}`;
    go({ selected: selection, startingQuestion: false, startingThread: false });
    writeLocation(undefined, selection);
    viewWork();
  }
  function viewWork(dynamicView = false) {
    if (!dynamicView) setDynamicUiThread(null);
    activateConversation();
    setWorkCollapsed(false);
    if (!persistent) window.localStorage.setItem(`commons:${slug}:workspace-work`, "expanded");
    setPane("work");
    requestAnimationFrame(() => draftDetails.current?.focus());
  }
  function restoreWork() { viewWork(Boolean(dynamicPresentation && dynamicUiThread === selectedThreadId)); }
  function closeWork() {
    workDismissal.current += 1;
    const wasTasks = pane === "tasks";
    setPane("conversation");
    setWorkCollapsed(true);
    if (persistent) setExpanded(false); else window.localStorage.setItem(`commons:${slug}:workspace-work`, "collapsed");
    requestAnimationFrame(() => (wasTasks ? tasksToggle.current ?? workToggle.current : workToggle.current ?? tasksToggle.current)?.focus());
  }
  /** Persistent layout: Tasks is the old Trip board / task list, opened in Work only when asked for. */
  function toggleTasks() {
    if (pane === "tasks") { closeWork(); return; }
    activateConversation();
    setPane("tasks");
    requestAnimationFrame(() => draftDetails.current?.focus());
  }
  /** A task chosen from the Tasks surface opens its conversation and details, unless the reader moved on or closed Work meanwhile. */
  // After the server fell back from an unavailable linked thread, drop that ID from the address so reload, copy and rail return don't repeat it.
  useEffect(() => {
    if (!entryNotice) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("thread")) return;
    url.searchParams.delete("thread");
    window.history.replaceState(window.history.state, "", url.pathname + url.search);
  }, [entryNotice]);
  /** Poll results from Tasks or a next step: nothing while busy, and a late load never reopens dismissed Work or a different selection. */
  function openPollResults(id: string) {
    if (busy || blocked || conflict) return;
    const value = `poll:${id}`, dismissal = workDismissal.current;
    void discuss(value).then(() => {
      if (!alive.current || view.current.selected !== value || workDismissal.current !== dismissal) return;
      setShowItineraryResults(true); setPane("work");
    });
  }
  async function openFromTasks(value: string) {
    if (!persistent) { await discuss(value); return; }
    const dismissal = workDismissal.current;
    await discuss(value);
    if (!alive.current || view.current.selected !== value || workDismissal.current !== dismissal) return;
    setPane("work");
    requestAnimationFrame(() => draftDetails.current?.focus());
  }
  function changeRatio(next: number, commit: boolean) { setWorkRatio(next); if (commit) writeRatio(slug, actorId, next); }
  function resetRatio() { setWorkRatio(DEFAULT_WORK_RATIO); writeRatio(slug, actorId, DEFAULT_WORK_RATIO); }
  /** True while the organizer is still where the command was sent from. A late result must never steal focus. */
  const overviewActive = useRef(showOverview || !active);
  useLayoutEffect(() => { overviewActive.current = showOverview || !active; }, [showOverview, active]);
  function onOrigin(origin: string) {
    if (embedded && overviewActive.current) return false;
    const now = view.current;
    if (now.startingThread || now.startingQuestion && !workspaceThreadId(now.selected, threadRef.current)) return newThreadId.current === origin;
    return workspaceThreadId(now.selected, threadRef.current) === origin;
  }
  function openThread(threadId: string, next: CoordinatorThread) {
    onActivate?.();
    threadCache.current.set(threadId, next);
    newThreadId.current = null; firstNewCommand.current = null;
    setThread(next);
    go({ selected: `thread:${threadId}`, startingQuestion: false, startingThread: false, starterId: null });
    setPane("conversation");
    writeLocation(threadId);
    focusComposer();
  }
  /** Saved, so the text now lives in the thread. Cleared only if the box still holds exactly what was sent. */
  function confirmSent(target: UnsentDestination, sent: string) {
    setScopedDrafts(value => value[draftScope]?.[target] === sent ? { ...value, [draftScope]: { ...value[draftScope], [target]: "" } } : value);
    if (actorId) clearUnsentIfSent(slug, actorId, target, sent);
  }
  /**
   * Look at the saved result of a command and bring the visible state up to date, attaching it to its origin thread. Returns what the UI did about
   * a navigation result: `true` = it opened the thread, `false` = it did not (the organizer had moved on, or the thread could not be loaded),
   * `undefined` = the result has no navigation to apply. Voice speaks exactly that outcome.
   */
  async function applyResult(result: TurnResult, origin: string): Promise<boolean | undefined> {
    if (result.status === "completed" && result.capability === "add_activities") window.dispatchEvent(new Event("commons:trip-state-changed"));
    const navigation = result.navigation;
    const opens = navigation && (navigation.kind === "switched" || navigation.kind === "created") ? navigation : null;
    try {
      if (onOrigin(origin)) {
        const next = await loadThread(origin);
        if (onOrigin(origin)) {
          const canPresent = mayPresentPollResult(pollResultOrigins.current.get(result.commandId), { selection: view.current.selected, dismissal: workDismissal.current });
          if (view.current.startingThread || view.current.startingQuestion) openThread(origin, next); else merge(next);
          const pollDraft = result.status === "completed" && result.artifacts.find(item => item.kind === "poll_draft");
          if (canPresent && pollDraft && next.drafts.some(draft => draft.id === pollDraft.id)) {
            go({ selected: `draft:${pollDraft.id}`, startingQuestion: false, startingThread: false, starterId: null });
            writeLocation(origin, `draft:${pollDraft.id}`);
            setShowItineraryResults(false);
            viewWork();
          } else {
            const itineraryDraft = result.status === "completed" && result.artifacts.find(item => item.kind === "itinerary_draft");
            if (canPresent && itineraryDraft && next.turns.some(turn => turn.workspace?.itineraryDraft?.id === itineraryDraft.id)) {
              const selection = `itinerary:${itineraryDraft.id}`;
              go({ selected: selection, startingQuestion: false, startingThread: false, starterId: null });
              writeLocation(origin, selection);
              setShowItineraryResults(false);
              viewWork();
            }
          }
        } else if (alive.current) setThread(value => ({ ...value, threads: next.threads }));
      } else {
        const next = await loadThread(origin);
        if (alive.current) setThread(value => value.activeThreadId === origin ? next : ({ ...value, threads: next.threads }));
      }
      if (opens && onOrigin(origin)) {
        const target = await loadThread(opens.threadId);
        // Switch only if the organizer is still where they asked; otherwise the receipt waits in the origin thread.
        if (onOrigin(origin)) { openThread(opens.threadId, target); return true; }
      }
      return opens ? false : undefined;
    } catch (cause) {
      if (alive.current) showFailure(cause, "The reply is saved, but the workspace couldn’t reload. Use Refresh conversation.");
      return opens ? false : undefined;
    }
  }
  /** Clear only the source identities in a completed command, including reload/lookup recovery. */
  function finishSourceCommand(commandId: string, supplied?: TurnCommand, sentDestination?: UnsentDestination) {
    if (!actorId) return;
    const command = supplied ?? loadPendingCommands(slug, actorId).find(item => item.command.commandId === commandId)?.command;
    const ids = command?.attachments?.map(ref => ref.id) ?? [];
    if (command && ids.length) {
      for (const dest of new Set([destinationOfCommand(command), ...(sentDestination ? [sentDestination] : [])])) {
        const scope = `${draftScope}:${dest}`;
        setClearedAttachments(value => ({ ...value, [scope]: [...new Set([...(value[scope] ?? []), ...ids])] }));
        setAttachmentStates(value => value[scope] ? { ...value, [scope]: { ...value[scope], refs: value[scope].refs.filter(ref => !ids.includes(ref.id)) } } : value);
        try {
          const key = `commons:${slug}:${actorId}:sources:${dest}`;
          const stored = JSON.parse(window.sessionStorage.getItem(key) ?? "[]");
          if (Array.isArray(stored)) {
            const remaining = stored.filter(row => !ids.includes(row.id));
            if (remaining.length) window.sessionStorage.setItem(key, JSON.stringify(remaining)); else window.sessionStorage.removeItem(key);
          }
        } catch { /* Mounted references are still cleared; server history remains intact. */ }
      }
    }
    forgetPendingCommand(slug, actorId, commandId);
  }
  async function watchTurn(commandId: string, origin: string | null, options: { attempts?: number } = {}) {
    const settled = await recoverTurn(slug, commandId, { lookupAttempts: options.attempts ?? 12, pollMs: recoveryTiming.pollMs * 1.5, isActive: () => alive.current });
    if (!alive.current) return;
    if (settled.kind === "result") {
      if (settled.result.thread) turnVersions.current.set(settled.result.thread.id, Math.max(turnVersions.current.get(settled.result.thread.id) ?? 0, settled.result.thread.turnVersion));
      if (settled.result.status === "completed") finishSourceCommand(commandId);
      await applyResult(settled.result, origin ?? settled.result.thread?.id ?? "");
    }
  }
  async function resumeStored(command: TurnCommand) {
    pollResultOrigins.current.set(command.commandId, { selection: command.artifact?.kind === "poll" ? `poll:${command.artifact.id}` : destinationOfCommand(command), dismissal: workDismissal.current });
    const settled = await recoverTurn(slug, command.commandId, { lookupAttempts: 1, isActive: () => alive.current });
    if (!alive.current || !actorId) return;
    const target = destinationOfCommand(command);
    if (settled.kind === "result") {
      if (settled.result.status === "completed") finishSourceCommand(command.commandId, command);
      confirmSent(target, command.text);
      if (command.target.kind === "new" && newThreadId.current === null && (view.current.startingThread || view.current.startingQuestion) && settled.result.thread) {
        // The page reloaded mid-send from a new conversation: the thread it created is where the message lives now.
        newThreadId.current = command.target.threadId;
      }
      await applyResult(settled.result, command.target.threadId);
      if (settled.result.status === "pending" && settled.result.thread) void watchTurn(command.commandId, command.target.threadId);
    } else if (settled.kind === "not_saved") {
      // Two lookups found nothing. That is not proof: a request still being committed can land afterwards, so the copy says so, and a resend of the same
      // words reuses the command (and thread) id, so it is saved once either way.
      forgetPendingCommand(slug, actorId, command.commandId);
      if (!readUnsent(slug, actorId, target)) setPromptFor(target, command.text);
      commandIds.current.set(commandKey({ destination: command.target, inputMode: command.inputMode, text: command.text, artifact: command.artifact, explicitAction: command.explicitAction, attachments: command.attachments }), command.commandId);
      if (command.target.kind === "new" && newThreadId.current === null && (view.current.startingThread || view.current.startingQuestion)) { newThreadId.current = command.target.threadId; firstNewCommand.current = command; }
      setError("Commons hasn’t confirmed your last message yet, and nothing has appeared in the thread. It’s back in the message box. Send it again as it is and it will be saved only once; if you change it, the earlier version may still appear.");
    } else if (settled.kind === "rejected") {
      setFailure({ message: settled.error.userMessage, code: settled.error.code });
    } else setError(settledMessage(settled));
  }
  async function checkAgain() {
    if (!unconfirmed) return;
    const command = unconfirmed;
    setFailure(null);
    const settled = await recoverTurn(slug, command.commandId, { lookupAttempts: 2, pollMs: recoveryTiming.pollMs, isActive: () => alive.current });
    if (!alive.current) return;
    if (settled.kind === "result") {
      setUnconfirmed(null);
      if (settled.result.status === "completed") finishSourceCommand(command.commandId, command);
      confirmSent(destinationOfCommand(command), command.text);
      await applyResult(settled.result, command.target.threadId);
    } else if (settled.kind === "rejected") setFailure({ message: settled.error.userMessage, code: settled.error.code });
    else setError(settledMessage(settled)); // still not confirmed: it stays here, remembered, with Check again
  }
  function destinationOfCommand(command: TurnCommand): UnsentDestination {
    if (command.target.kind === "existing" && command.artifact?.kind === "draft" && command.artifact.selection !== "thread_context") return `draft:${command.artifact.id}`;
    return command.target.kind === "new" ? command.explicitAction?.kind === "ask_group" ? "ask" : "new" : `thread:${command.target.threadId}`;
  }
  type SendContext = { sent: string; dest: UnsentDestination; key: string | null; title: string; researchSent?: string; retry?: boolean };
  async function dispatch(command: TurnCommand, context: SendContext): Promise<VoiceDelegateOutcome> {
    const outcome = await dispatchOnce(command, context);
    // The thread id of a new conversation is already taken (an earlier, unconfirmed first send created it) and this send is different, for example edited.
    if (outcome.kind === "rejected" && outcome.code === "command_mismatch" && command.target.kind === "new" && !context.retry && alive.current) return adoptCreatedConversation(command, context, outcome);
    return outcome;
  }
  /**
   * The first send to a new conversation reached Commons but was never confirmed; the organizer then changed the message. The edited send is a different
   * request for a thread that already exists, so the server refuses it (`command_mismatch`) and every later send would be refused the same way. Look up the
   * stored first command: if it was saved, open the thread it created and send the edited message there as an ordinary turn with a new command id. If it
   * cannot be found, start over with a new thread id so the next send works, and say so.
   */
  async function adoptCreatedConversation(command: TurnCommand, context: SendContext, refused: VoiceDelegateOutcome): Promise<VoiceDelegateOutcome> {
    const threadId = command.target.threadId;
    const remembered = firstNewCommand.current;
    const first = remembered && remembered.target.threadId === threadId && remembered.commandId !== command.commandId ? remembered
      : actorId ? loadPendingCommands(slug, actorId).map(item => item.command).find(item => item.target.kind === "new" && item.target.threadId === threadId && item.commandId !== command.commandId) : undefined;
    const found = first ? await recoverTurn(slug, first.commandId, { lookupAttempts: 2, pollMs: recoveryTiming.pollMs, isActive: () => alive.current }) : null;
    if (!alive.current) return refused;
    if (first && found?.kind === "result") {
      setFailure(null); setUnconfirmed(null);
      if (found.result.thread) turnVersions.current.set(found.result.thread.id, Math.max(turnVersions.current.get(found.result.thread.id) ?? 0, found.result.thread.turnVersion));
      if (found.result.status === "completed") finishSourceCommand(first.commandId, first);
      confirmSent(destinationOfCommand(first), first.text);
      await applyResult(found.result, threadId);
      // Only if the organizer is still on that conversation does the edited message follow it there.
      if (view.current.selected !== `thread:${threadId}` || view.current.startingThread || view.current.startingQuestion) return refused;
      const resent = await sendMessage(context.sent, command.inputMode, command.voice, { attachments: command.attachments });
      if (resent.kind === "result") confirmSent(context.dest, context.sent);
      // Set after the resend (a send clears the notice), so it stays on screen next to the result.
      if (alive.current) setNotice("Your earlier message had reached Commons and started this conversation, so your changed message was sent here as a new message.");
      return resent;
    }
    // Nothing can be found for the earlier message: start over with a new thread id so the next send is not refused.
    newThreadId.current = null; firstNewCommand.current = null;
    if (actorId) forgetPendingCommand(slug, actorId, command.commandId);
    setError("Commons couldn’t match that to your earlier message, so nothing new was saved. Your message is still here. Send it again to start a fresh conversation.");
    return refused;
  }
  async function dispatchOnce(command: TurnCommand, context: SendContext): Promise<VoiceDelegateOutcome> {
    if (inFlight.current) return { kind: "notice", notice: "busy" };
    pollResultOrigins.current.set(command.commandId, { selection: view.current.selected, dismissal: workDismissal.current });
    const startedAt = elapsedMs();
    inFlight.current = true; replying.current = true;
    if (command.target.kind === "new" && firstNewCommand.current?.target.threadId !== command.target.threadId) firstNewCommand.current = command;
    setSending({ threadId: command.target.threadId, title: context.title, source: command.inputMode });
    setFailure(null); setUnconfirmed(null); setNotice(""); setInvitationDismissed(true);
    abort.current = new AbortController();
    // Saved BEFORE sending so a reload or timeout can look this command up instead of guessing.
    if (actorId) rememberPendingCommand(slug, actorId, command);
    // The message appears in its thread at once, marked as sending; the reply grows beneath it as the server reports real progress.
    setLive({ commandId: command.commandId, origin: command.target.threadId, originKind: command.target.kind, turnId: null, detached: false,
      userText: command.text, authorName: actorName, coordinatorName, phase: "sending", text: "", stopRequested: false, stopNote: null });
    if (command.inputMode === "text") scrollToLatest();
    try {
      const settled = await sendTurnStream(slug, command, { signal: abort.current.signal, isActive: () => alive.current, onUpdate: update => {
        if (!alive.current) return;
        // The request is saved: the text now lives in the thread, so the box is free for the next message.
        if (update.kind === "accepted") confirmSent(context.dest, context.sent);
        setLive(value => value?.commandId !== command.commandId ? value
          : update.kind === "accepted" ? { ...value, turnId: update.turnId, phase: value.phase === "sending" ? "context" : value.phase }
          : update.kind === "phase" ? { ...value, phase: update.phase } : { ...value, text: update.text });
      } });
      return await settle(settled, command, context, elapsedMs() - startedAt);
    } finally {
      inFlight.current = false; replying.current = false;
      if (alive.current) {
        setSending(null); setLive(value => value?.commandId === command.commandId ? null : value);
        // The one queued follow-up goes next, but only to the conversation it was written for; if the organizer moved on, it stays in its box.
        const next = queuedNext.current;
        if (next) {
          queuedNext.current = null; setQueued(false);
          window.setTimeout(() => {
            if (!alive.current) return;
            if (latestPrompt.current.dest === next.dest && latestPrompt.current.prompt.trim()) queuedTextSend.current(latestPrompt.current.prompt);
            else setNotice("Your queued message wasn’t sent because you moved to another conversation. It’s still in the message box where you typed it.");
          }, 0);
        }
        // Stop turns back into a disabled Send, which drops keyboard focus; hand it to the composer, but never take it from elsewhere.
        if (command.inputMode === "text") requestAnimationFrame(() => { if (typeof document === "undefined") return; if (document.activeElement === document.body || document.activeElement?.classList.contains("workspace-send")) composer.current?.focus(); });
      }
      abort.current = null;
    }
  }
  async function settle(settled: TurnSettled, command: TurnCommand, context: { sent: string; dest: UnsentDestination; key: string | null; researchSent?: string; retry?: boolean }, latencyMs: number): Promise<VoiceDelegateOutcome> {
    const origin = command.target.threadId;
    // Content-free, correlated by ids: mode, capability, outcome, error code, latency. Never the request, the reply or any audio.
    const track = (name: "coordinator_reply_received" | "coordinator_reply_failed", extra: Record<string, string | number | boolean>) =>
      trackProductEvent(name, { properties: { surface: "workspace", personality, hasDraft: Boolean(command.artifact), inputMode: command.inputMode, commandId: command.commandId, threadId: origin, latencyMs, ...(command.voice ? { sessionId: command.voice.sessionId, delegationId: command.voice.delegationId } : {}), ...extra } });
    if (settled.kind === "result") {
      const { result } = settled;
      // Synchronous, so the very next send (typed or spoken) carries this version.
      if (result.thread) turnVersions.current.set(result.thread.id, Math.max(turnVersions.current.get(result.thread.id) ?? 0, result.thread.turnVersion));
      if (result.status === "completed") finishSourceCommand(command.commandId, command, context.dest);
      if (context.key) commandIds.current.delete(context.key);
      confirmSent(context.dest, context.sent);
      if (context.researchSent) setResearchQuery(value => value === context.researchSent ? "" : value);
      track(result.status === "failed" ? "coordinator_reply_failed" : "coordinator_reply_received", { status: result.status, outcome: result.status, ...(result.turnId ? { turnId: result.turnId } : {}), ...(result.capability ? { capability: result.capability } : {}), ...(result.error ? { errorCode: result.error.code } : {}) });
      // Stop was pressed but the reply was already being saved: say so, rather than leaving the organizer to wonder.
      if (result.status === "completed" && stopAsked.current.has(command.commandId)) setNotice("That reply finished before it could be stopped, so it’s saved in the thread.");
      const navigationApplied = await applyResult(result, origin);
      if (result.status === "completed" && result.artifacts.some(item => item.kind === "trip_task_proposal" && !item.reviewRequired)) window.dispatchEvent(new Event("commons:trip-tasks-changed"));
      if (result.status === "completed" && result.artifacts.some(item => item.kind === "research_run") && !result.artifacts.some(item => item.kind === "itinerary_draft") && result.turnId && onOrigin(origin) && mayPresentPollResult(pollResultOrigins.current.get(result.commandId), { selection: view.current.selected, dismissal: workDismissal.current })) openResearch(result.turnId);
      if (result.status === "completed" && result.artifacts.some(item => item.kind === "draft_edit_proposal") && onOrigin(origin)) { setItineraryProposalId(result.turnId); setWorkCollapsed(false); }
      return { kind: "result", result, ...(navigationApplied !== undefined ? { navigationApplied } : {}) };
    }
    track("coordinator_reply_failed", { outcome: settled.kind, ...(settled.kind === "rejected" ? { errorCode: settled.error.code } : {}) });
    // Nothing is confirmed saved: the text stays where it was typed and nothing is submitted again on its own.
    if (settled.kind === "rejected") {
      if (actorId) forgetPendingCommand(slug, actorId, command.commandId);
      setFailure({ message: settled.error.userMessage, code: settled.error.code });
      if (settled.error.code === "stale_version") await loadThread(origin).then(next => { if (onOrigin(origin) && alive.current) merge(next); }).catch(() => {});
      if (settled.error.code === "command_mismatch" && context.retry) setPromptFor(context.dest, context.sent);
      return { kind: "rejected", code: settled.error.code, answerOnly: !command.artifact && !command.explicitAction };
    }
    // Not confirmed either way (a lookup found nothing, but a request that was still committing can land after it): the command stays remembered and
    // the same id is reused by a resend, so it is saved once whether or not the first attempt arrives.
    setUnconfirmed(command);
    if (settled.kind === "not_saved") { setError(settledMessage(settled)); return { kind: "not_saved" }; }
    setError(settledMessage(settled));
    return { kind: "unconfirmed" };
  }
  /**
   * One request through the turn path, typed or spoken. Everything it decides comes from refs (`view`, `threadRef`, `turnVersions`,
   * `latestUi`), so a spoken request that arrives before React re-renders still carries the newest thread, version and flags.
   * A spoken request differs in exactly three ways: its command id and voice ids come from the delegation, it never consumes the typed
   * search box, and it never carries an Ask the group UI action. Speaking alone never creates a poll draft: only an explicit spoken request
   * ("make a poll asking...") is routed to poll preparation by the server, which holds spoken requests to its strongest phrasing.
   */
  async function sendMessage(sent: string, source: "text" | "voice", voice?: { sessionId: string; delegationId: string }, options: { commandId?: string; explicitAction?: TurnCommand["explicitAction"]; attachments?: TurnCommand["attachments"] } = {}): Promise<VoiceDelegateOutcome> {
    const text = sent.trim();
    const ui = latestUi.current;
    // Continuity: a typed follow-up while a reply is still being written waits its turn as the one queued message (it is still in the box, so nothing is lost).
    if (continuity && source === "text" && text && replying.current && !ui.busy && !options.explicitAction) { queuedNext.current = { dest: latestPrompt.current.dest }; setQueued(true); return { kind: "notice", notice: "busy" }; }
    if (inFlight.current || ui.busy) return { kind: "notice", notice: "busy" };
    if (ui.blocked) return { kind: "notice", notice: "draft_blocked" };
    if (ui.conflict) return { kind: "notice", notice: "workspace_conflict" };
    if (!ui.conversationAvailable || !text) return { kind: "notice", notice: "unavailable" };
    const originSelection = view.current.selected;
    let document: DocumentState | null = null;
    if (!itineraryFlush.current && legacyItineraryFlush.current) { try { await legacyItineraryFlush.current(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Save the document before sending."); return { kind: "notice", notice: "draft_blocked" }; } }
    if (view.current.selected !== originSelection || inFlight.current || latestUi.current.conflict) return { kind: "notice", notice: "busy" };
    if (itineraryFlush.current) {
      try { document = await itineraryFlush.current(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Save your document before sending. Your message is still here."); return { kind: "notice", notice: "draft_blocked" }; }
      // The destination may have changed while an autosave completed. Keep the message unsent.
      if (view.current.selected !== originSelection || inFlight.current || latestUi.current.conflict) return { kind: "notice", notice: "busy" };
    }
    const now = view.current;
    const latest = threadRef.current;
    const existingThreadId = !now.startingThread ? workspaceThreadId(now.selected, latest) : null;
    if (!existingThreadId && !now.startingQuestion && !now.startingThread && now.selected !== "new") return sendLegacy(text, source, now.selected, latest);
    // Typed search box: text turns only. Research spoken aloud is routed by the same capability from the request itself (no typed text is ever spoken or reused).
    const requestedResearch = source === "text" && ui.researchAvailable && Boolean(ui.researchQuery.trim());
    // An attendance statement is a direct instruction, never a poll starter, so it skips the Ask the group action.
    const attendanceStatement = !requestedResearch && reportsOwnAttendance(text);
    const tool = source === "text" ? coordinatorTool(text) : null;
    const askGroup = !tool && source === "text" && now.startingQuestion && !attendanceStatement && !requestedResearch;
    const explicitAction: TurnCommand["explicitAction"] | undefined = tool ? undefined : options.explicitAction ?? (document && itineraryOperation(text, true) === "refine" && !requestedResearch && !askGroup ? { kind: "itinerary", documentId: document.draft.id, baseVersion: document.draft.version } : requestedResearch ? { kind: "research", query: ui.researchQuery.trim() } : askGroup ? { kind: "ask_group", starterId: now.starterId, ...(now.starterId ? { workflowKey: coordinatorStarter(now.starterId).workflowKey } : {}) } : undefined);
    const requestText = (tool || attendanceStatement || source === "voice" || options.explicitAction ? text : starterMessage(now.starterId, text));
    let target: CommandDestination, dest: UnsentDestination, title: string;
    if (existingThreadId) {
      target = { kind: "existing", threadId: existingThreadId, expectedTurnVersion: turnVersions.current.get(existingThreadId) ?? (latest.activeThreadId === existingThreadId ? latest.version : 0) };
      dest = unsentDestinationFor(now, existingThreadId);
      title = latest.threads.find(item => item.id === existingThreadId)?.title ?? "this thread";
    } else {
      newThreadId.current ??= crypto.randomUUID();
      target = { kind: "new", threadId: newThreadId.current };
      dest = now.startingQuestion ? "ask" : "new";
      title = now.startingQuestion ? "Ask the group" : "a new conversation";
    }
    const artifact = explicitAction?.kind === "itinerary" ? undefined : existingThreadId ? selectedArtifact(latest, now.selected) : undefined;
    const key = commandKey({ destination: target, inputMode: source, text: requestText, artifact, explicitAction, attachments: options.attachments });
    const commandId = options.commandId ?? commandIds.current.get(key) ?? crypto.randomUUID();
    commandIds.current.set(key, commandId);
    const command = buildTurnCommand({ commandId, destination: target, inputMode: source, text: requestText, artifact, explicitAction, voice, attachments: options.attachments });
    return dispatch(command, { sent, dest, key, title, ...(requestedResearch ? { researchSent: ui.researchQuery } : {}) });
  }
  /**
   * A delegated spoken request. A typed send already in flight is waited out (never merged or dropped). A stale thread version on an
   * answer-only request is refreshed by the failed send itself, then retried exactly once; after that the catalog message is spoken.
   */
  async function delegateVoiceTurn(request: VoiceDelegation): Promise<VoiceDelegateOutcome> {
    const voice = { sessionId: request.sessionId, delegationId: request.delegationId };
    for (let waited = 0; inFlight.current && alive.current && waited < 20_000; waited += 100) await new Promise(resolve => setTimeout(resolve, 100));
    const first = await sendMessage(request.text, "voice", voice, { commandId: request.commandId });
    if (first.kind === "rejected" && first.code === "stale_version" && first.answerOnly && alive.current) return sendMessage(request.text, "voice", voice);
    return first;
  }
  /** Try again for a failed turn: the same command id, so the server finds its saved request instead of creating another. */
  async function retryTurn(turn: CoordinatorThread["turns"][number]) {
    if (inFlight.current || busy || !turn.threadId) return;
    const stored = actorId ? loadPendingCommands(slug, actorId).find(item => item.command.commandId === turn.commandId)?.command : undefined;
    const command = stored ?? retryCommandFor(turn, threadRef.current, turnVersions.current.get(turn.threadId) ?? threadRef.current.version);
    if (!command) return;
    await dispatch(command, { sent: turn.userText, dest: `thread:${turn.threadId}`, key: null, title: selectedThread?.title ?? "this thread", retry: true });
  }
  async function checkTurn(turn: CoordinatorThread["turns"][number]) {
    if (!turn.commandId || !turn.threadId) return;
    await watchTurn(turn.commandId, turn.threadId, { attempts: 1 });
  }
  /** Draft, poll and note contexts from before threads: the original single-request route, with stable error codes. */
  async function sendLegacy(text: string, source: "text" | "voice", selection: string, latest: CoordinatorThread): Promise<VoiceDelegateOutcome> {
    if (inFlight.current) return { kind: "notice", notice: "busy" };
    inFlight.current = true; setBusy(true); setSending({ threadId: "legacy", title: workspaceContextTitle(selection, latest), source }); setFailure(null); setInvitationDismissed(true);
    abort.current = new AbortController();
    const requestedResearch = source === "text" && latestUi.current.researchAvailable && Boolean(latestUi.current.researchQuery.trim());
    const draft = latest.drafts.find(item => selection === `draft:${item.id}` && !item.publishedPollId);
    const payload = { version: latest.version, prompt: text, draftId: draft?.id ?? null, draftVersion: draft?.version ?? null,
      ...(selection.startsWith("poll:") ? { contextPollId: selection.slice(5) } : {}), ...(selection.startsWith("note:") ? { contextTurnId: selection.slice(5) } : {}), ...(requestedResearch ? { researchQuery: researchQuery.trim() } : {}) };
    const key = JSON.stringify(payload);
    const commandId = commandIds.current.get(key) ?? crypto.randomUUID();
    commandIds.current.set(key, commandId);
    const dest = selection as UnsentDestination;
    try {
      const prior = new Set(latest.turns.map(turn => turn.id));
      const next = CoordinatorThreadSchema.parse(await requestJson(endpoint, { method: "POST", signal: abort.current.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, commandId }) }));
      merge(next);
      commandIds.current.delete(key);
      confirmSent(dest, text);
      if (requestedResearch) { setResearchQuery(value => value === researchQuery ? "" : value); viewWork(); }
      trackProductEvent("coordinator_reply_received", { properties: { surface: "workspace", personality, hasDraft: Boolean(draft) } });
      return { kind: "legacy_reply", text: [...next.turns].reverse().find(turn => !prior.has(turn.id))?.assistantText ?? next.turns.at(-1)?.assistantText ?? "The request is saved in the organizer thread for review." };
    } catch (cause) {
      trackProductEvent("coordinator_reply_failed", { properties: { surface: "workspace" } });
      const stopped = abort.current?.signal.aborted;
      if (stopped) setConflict(true);
      const message = stopped ? "Stopped waiting. Reload to check whether the reply was saved before continuing. Nothing was shared."
        : cause instanceof TypeError ? "The connection was interrupted. Your message is still here." : failureFrom(cause, "The reply couldn’t be saved.").message;
      if (stopped || cause instanceof TypeError) setError(message); else showFailure(cause, message);
      const code = cause instanceof CoordinatorRequestError ? cause.error.code : null;
      return code ? { kind: "rejected", code, answerOnly: false } : { kind: "unconfirmed" };
    } finally { inFlight.current = false; setBusy(false); setSending(null); abort.current = null; }
  }
  const returningItinerary = portabilityEnabled && Boolean(selectedThreadId) && returnedItinerary(prompt);
  const pastingItinerary = returningItinerary || !assistantUiEnabled && !startingQuestion && isItineraryPaste(prompt);
  const messageTooLong = prompt.length > (assistantUiEnabled ? 30000 : 1800) && !pastingItinerary;
  function openAddRecord(kind: CoordinatorAddKind) {
    if (working || conflict || inFlight.current) return;
    composer.current?.focus();
    if (onAddRecord) onAddRecord(kind);
    else {
      const query = new URLSearchParams({ arrival: "0", view: "coordinator", add: kind === "hotel" ? "stay" : kind === "activity" ? "thing" : kind });
      if (selectedThreadId) query.set("thread", selectedThreadId);
      router.push(`/c/${encodeURIComponent(slug)}?${query}`);
    }
  }
  async function sendText(text: string) {
    const addKind = addRecordCommand(text);
    if (addKind) { openAddRecord(addKind); return; }
    if (/^\/add(?:\s|$)/i.test(text.trim())) { setAddPickerOpen(true); setCommandDismissed(null); composer.current?.focus(); return; }
    if (portabilityEnabled && selectedThreadId && returnedItinerary(text)) { setPortabilitySeed({ text, token: crypto.randomUUID() }); setImportOpen(true); viewWork(); return; }
    if (!assistantUiEnabled && !startingQuestion && isItineraryPaste(text)) { if (!working && !blocked && !conflict && !inFlight.current) await startItinerary(text); return; }
    if (text.length > (assistantUiEnabled ? 30000 : 1800)) { setError("This message is too long. Split it into smaller sources; nothing was truncated."); return; }
    if (canAttachSources && (!sourceState || sourceState.blocked)) { setError("Wait for sources to finish, or remove the source with an error before sending."); return; }
    const refs = assistantUiEnabled ? sourceState?.refs ?? [] : [];
    const result = await sendMessage(text, "text", undefined, refs.length ? { attachments: refs } : {});
    return result;
  }
  function send() { void sendText(prompt); }
  /** Stop asks the server to stop writing. It never undoes a saved result: the stream then reports what was actually saved. */
  async function requestStop() {
    const current = live;
    if (!current || current.stopRequested) return;
    stopAsked.current.add(current.commandId);
    setLive(value => value?.commandId === current.commandId ? { ...value, stopRequested: true } : value);
    const stopped = await stopTurn(slug, current.commandId);
    if (!alive.current) return;
    if (stopped) { setStoppedCommands(value => new Set(value).add(current.commandId)); if (actorId) rememberStoppedCommand(slug, actorId, current.commandId); }
    else setLive(value => value?.commandId === current.commandId ? { ...value, stopNote: "This reply was already finishing, so it couldn’t be stopped. It will appear here when it’s saved." } : value);
  }
  // A turn still pending in the loaded thread (this browser after a reload, or another tab) is looked up until it settles.
  useEffect(() => {
    for (const turn of thread.turns) {
      if (turnStatusOf(turn) !== "pending" || !isOwnTurn(turn, actorId) || !turn.commandId || watching.current.has(turn.commandId)) continue;
      const commandId = turn.commandId;
      watching.current.add(commandId);
      void watchTurn(commandId, turn.threadId ?? null).finally(() => watching.current.delete(commandId));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- watchTurn only reads refs and stable setters.
  }, [thread.turns, actorId]);
  // Commands sent before this page loaded (a reload, or the Home entry): find out what happened before anything is retried.
  useEffect(() => {
    if (!actorId) return;
    // Snapshot before deferring: a slow first frame must not recover a request
    // newly sent by this mounted page while its initial POST is still in flight.
    const stored = loadPendingCommands(slug, actorId);
    const frame = requestAnimationFrame(() => { for (const item of stored) void resumeStored(item.command); });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per trip and actor.
  }, [slug, actorId]);
  async function action(turnId: string, kind: "apply" | "dismiss" | "save" | "archive" | "unarchive" | "undo_attendance") {
    if (inFlight.current || blocked || itineraryDirty || conflict) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const next = CoordinatorThreadSchema.parse(await requestJson(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ turnId, ...(selectedThreadId ? { threadId: selectedThreadId } : {}), action: kind, commandId: crypto.randomUUID() }) }));
      merge(next);
      if (kind === "apply") setRevision(value => value + 1);
      if (kind === "archive" && selected === `note:${turnId}`) leaveRemovedContext(next);
    } catch (cause) { showFailure(cause, "The change wasn’t confirmed. Reload to check."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function tripAction(turnId: string, kind: "revise_trip" | "apply_trip" | "dismiss_trip", expectedVersion: number, changes?: TripChangeProposal["changes"], planContact?: { text: string; include: boolean }) {
    if (inFlight.current || blocked || itineraryDirty || conflict) return;
    inFlight.current = true; setBusy(true); setError("");
    const key = `${turnId}:${kind}:${expectedVersion}`;
    const body = JSON.stringify({ turnId, ...(selectedThreadId ? { threadId: selectedThreadId } : {}),
      action: kind, expectedVersion, ...(changes ? { changes } : {}), ...(planContact ? { planContact } : {}) });
    const prior = pendingTripCommands.current.get(key);
    const commandId = prior?.body === body ? prior.id : crypto.randomUUID();
    pendingTripCommands.current.set(key, { id: commandId, body });
    try {
      const result = await requestJson(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...JSON.parse(body), commandId }) });
      pendingTripCommands.current.delete(key);
      merge(CoordinatorThreadSchema.parse(result));
      if (kind === "apply_trip") { setRevision(value => value + 1); router.refresh(); }
    } catch (cause) { showFailure(cause, "That trip update wasn’t confirmed. Reload to check what was saved."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  /** The import is saved; select its exact document unless the organizer has moved on. */
  function importApplyStarted() {
    const importPresentation = { selection: view.current.selected, dismissal: workDismissal.current };
    return async (receipt: ItineraryImportReceipt) => {
      const next = await loadThread(receipt.threadId);
      if (!alive.current || !onOrigin(receipt.threadId)) return;
      merge(next);
      if (!mayPresentPollResult(importPresentation, { selection: view.current.selected, dismissal: workDismissal.current })) return;
      const saved = next.turns.findLast(turn => turn.threadId === receipt.threadId && turn.workspace?.itineraryDraft?.id === receipt.documentId)?.workspace?.itineraryDraft;
      if (!saved || saved.version < receipt.version) throw new Error("The saved itinerary could not be reloaded.");
      go({ selected: `itinerary:${receipt.documentId}`, startingQuestion: false, startingThread: false });
      setImportOpen(false);
      viewWork();
    };
  }
  async function saveItineraryDocument(request: DocumentSave): Promise<DocumentState> {
    if (inFlight.current || draftBlocked || conflict) throw new Error("Finish the current action before saving. Your text is still here.");
    const origin = request.threadId;
    let next: CoordinatorThread;
    try { next = CoordinatorThreadSchema.parse(await requestJson(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      action: "itinerary", operation: "revise", threadId: origin, turnId: request.turnId,
      commandId: request.commandId, expectedVersion: request.expectedVersion, content: request.content,
    }) })); } catch (cause) {
      if (cause instanceof CoordinatorRequestError && cause.status === 409 && alive.current && onOrigin(origin)) await reload();
      throw cause;
    }
    const receipt = next.itineraryReceipt;
    if (!receipt || receipt.commandId !== request.commandId || receipt.documentId !== request.documentId || receipt.threadId !== origin || receipt.version !== request.expectedVersion + 1) throw new Error("The save receipt could not be verified. Your text is still here.");
    const latest = [...next.turns].reverse().find(turn => turn.workspace?.itineraryDraft?.id === request.documentId);
    if (!latest?.workspace?.itineraryDraft) throw new Error("The saved document could not reload. Your text is still here.");
    if (alive.current && onOrigin(origin)) merge(next);
    return { turnId: request.turnId, draft: { ...latest.workspace.itineraryDraft, version: receipt.version, content: receipt.after }, observed: { turnId: latest.id, draft: latest.workspace.itineraryDraft } };
  }
  async function itineraryAction(turnId: string, expectedVersion: number, change: ItineraryReviewAction) {
    if (inFlight.current || draftBlocked || conflict || !selectedThreadId) throw new Error("This document action is blocked. Nothing was saved.");
    const origin = selectedThreadId;
    const documentId = threadRef.current.turns.find(turn => turn.id === turnId)?.workspace?.itineraryDraft?.id;
    const latest = [...threadRef.current.turns].reverse().find(turn => turn.threadId === origin && turn.workspace?.itineraryDraft?.id === documentId);
    if (!latest?.workspace?.itineraryDraft) throw new Error("Reload the current document before continuing.");
    const { reviewedVersion, ...reviewChange } = change;
    const canonical = change.operation === "apply" || change.operation === "update_plan";
    // Activity additions and record updates bind to the exact reviewed version. A task-only approval follows its own
    // just-saved draft edit; the server still checks the current version, owner and linked record.
    if (canonical && (change.operation === "update_plan" || (change.selectedIds ?? []).length > 0) && (reviewedVersion === undefined || reviewedVersion !== latest.workspace.itineraryDraft.version)) throw new Error("The itinerary changed. Review the current version before saving additions.");
    turnId = latest.id; expectedVersion = reviewedVersion ?? latest.workspace.itineraryDraft.version;
    inFlight.current = true; setBusy(true);
    const body = JSON.stringify({ turnId, threadId: selectedThreadId, action: "itinerary", expectedVersion, ...reviewChange });
    const key = `itinerary:${turnId}:${expectedVersion}:${change.operation}`;
    const prior = pendingTripCommands.current.get(key), commandId = prior?.body === body ? prior.id : crypto.randomUUID();
    pendingTripCommands.current.set(key, { id: commandId, body });
    try {
      const next = CoordinatorThreadSchema.parse(await requestJson(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...JSON.parse(body), commandId }) }));
      if (change.operation === "apply") {
        const saved = next.turns.findLast(turn => turn.workspace?.itineraryDraft?.id === documentId)?.workspace?.itineraryDraft;
        if (!saved || saved.version <= expectedVersion || !(change.selectedIds ?? []).every(id => saved.receipts.some(receipt => receipt.candidateId === id && receipt.kind === "plan"))
          || !(change.taskIds ?? []).every(id => saved.receipts.some(receipt => receipt.candidateId === id && receipt.kind === "task"))) throw new Error("The save could not be confirmed from saved receipts. Refresh the conversation before trying again.");
      }
      if (change.operation === "update_plan") {
        const saved = next.turns.findLast(turn => turn.workspace?.itineraryDraft?.id === documentId)?.workspace?.itineraryDraft;
        if (!saved || saved.version <= expectedVersion || !(change.planUpdates ?? []).every(update => saved.planUpdates?.some(row => row.candidateId === update.candidateId && row.savedId === update.savedId && row.draftVersion === expectedVersion + 1))) throw new Error("The updates could not be confirmed from saved receipts. Refresh the conversation before trying again.");
      }
      pendingTripCommands.current.delete(key);
      if (alive.current && onOrigin(origin)) merge(next);
      if (change.operation === "prepare_poll") {
        if (!alive.current || !onOrigin(origin)) throw new Error("Return to the originating conversation to publish this itinerary.");
        const prepared = next.turns.findLast(turn => turn.workspace?.itineraryDraft?.id === documentId)?.workspace?.itineraryDraft?.sharingDraft?.draftId;
        const projection = next.drafts.find(row => row.id === prepared);
        if (!projection) throw new Error("The participant version could not be prepared. Nothing was published.");
        return projection;
      }
      if (canonical) { window.dispatchEvent(new Event("commons:trip-state-changed")); window.dispatchEvent(new Event("commons:trip-tasks-changed")); router.refresh(); }
    } catch (cause) {
      if (cause instanceof CoordinatorRequestError && cause.status === 409 && alive.current && onOrigin(origin)) {
        await reload();
        throw new CoordinatorRequestError({...cause.error,userMessage:"This itinerary or its saved trip details changed. The latest document is loaded; review it again before preparing group review. If trip details changed, ask Commons to update the itinerary first."},409);
      }
      throw cause;
    } finally { inFlight.current = false; setBusy(false); }
  }
  async function taskProposalAction(turnId: string, expectedVersion: number, operation: "apply" | "dismiss" | "undo") {
    if (inFlight.current || blocked || conflict || !selectedThreadId) return;
    const origin = selectedThreadId;
    inFlight.current = true; setBusy(true);
    const body = JSON.stringify({ action: "trip_task", turnId, threadId: selectedThreadId, expectedVersion, operation });
    const key = `trip-task:${turnId}:${expectedVersion}:${operation}`, prior = pendingTripCommands.current.get(key);
    const commandId = prior?.body === body ? prior.id : crypto.randomUUID();
    pendingTripCommands.current.set(key, { id: commandId, body });
    try {
      const next = CoordinatorThreadSchema.parse(await requestJson(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...JSON.parse(body), commandId }) }));
      pendingTripCommands.current.delete(key);
      if (alive.current && onOrigin(origin)) merge(next);
      if (operation === "apply" || operation === "undo") { window.dispatchEvent(new Event("commons:trip-tasks-changed")); router.refresh(); }
    } finally { inFlight.current = false; setBusy(false); }
  }
  async function updateGoal(threadId: string, expectedVersion: number, status: "active" | "archived") {
    if (inFlight.current || blocked || itineraryDirty || conflict) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const next = CoordinatorThreadSchema.parse(await requestJson(threadsEndpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ threadId, expectedVersion, status, commandId: crypto.randomUUID() }) }));
      if (status === "archived") {
        const root = await requestJson(endpoint, { cache: "no-store" }).then(body => CoordinatorThreadSchema.parse(body)).catch(() => next);
        setThread(root);
        leaveRemovedContext(root);
      } else { setThread(next); go({ selected: `thread:${threadId}`, startingQuestion: false, startingThread: false }); setPane("conversation"); writeLocation(threadId); }
    } catch (cause) { showFailure(cause, "That thread couldn’t be updated."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function linkIdea(itineraryItemId: string, action: "link" | "unlink") {
    if (!selectedThread || inFlight.current || blocked || conflict) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      setThread(CoordinatorThreadSchema.parse(await requestJson(threadsEndpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ threadId: selectedThread.id, itineraryItemId, action, expectedThreadVersion: selectedThread.version, commandId: crypto.randomUUID() }) })));
      viewWork();
    } catch (cause) { showFailure(cause, "That idea couldn’t be linked."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function archiveResource(resourceType: "draft" | "poll", resourceId: string, archived: boolean) {
    if (inFlight.current || blocked || itineraryDirty || conflict) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const next = CoordinatorThreadSchema.parse(await requestJson(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resourceType, resourceId, action: archived ? "unarchive" : "archive", commandId: crypto.randomUUID() }) }));
      merge(next);
      if (!archived && selected === `${resourceType}:${resourceId}`) leaveRemovedContext(next);
    } catch (cause) { showFailure(cause, "That topic couldn’t be archived. Try again."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function earlier() {
    if (inFlight.current || !thread.turns[0]) return;
    inFlight.current = true; setBusy(true);
    try {
      const next = CoordinatorThreadSchema.parse(await requestJson(`${endpoint}?${selectedThreadId ? `threadId=${encodeURIComponent(selectedThreadId)}&` : ""}before=${thread.turns[0].sequence}`, { cache: "no-store" }));
      const anchorScroller = persistent ? conversationScroller() : messages.current;
      if (anchorScroller) historyAnchor.current = { height: anchorScroller.scrollHeight, top: anchorScroller.scrollTop };
      setThread(value => {
        const merged = { ...value, hasEarlier: next.hasEarlier, turns: [...next.turns.filter(turn => !value.turns.some(item => item.id === turn.id)), ...value.turns] };
        if (merged.activeThreadId) threadCache.current.set(merged.activeThreadId, merged);
        return merged;
      });
    } catch (cause) { showFailure(cause, "Earlier messages couldn’t be loaded. Try again."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  /** Open a selection. Each place keeps its own unsent text, so nothing moves and nothing needs confirming. */
  async function discuss(value: string) {
    if (blocked || busy || conflict) return;
    onActivate?.();
    go({ selected: value, startingQuestion: false, startingThread: false, starterId: null });
    setPane("conversation");
    const threadId = workspaceThreadId(value, threadRef.current);
    if (threadId) {
      writeLocation(threadId, value);
      setBusy(true); setError("");
      try {
        const next = await loadThread(threadId);
        // The organizer may have moved again while this loaded; only the place they are still on is shown.
        if (view.current.selected === value && !view.current.startingThread && !view.current.startingQuestion) setThread(next);
      } catch (cause) { showFailure(cause, "That Trip board thread couldn’t be opened."); }
      finally { setBusy(false); }
    } else writeLocation();
    focusComposer();
  }
  /** Continuity: the relations and outcomes around a conversation. Failures are quiet: the conversation itself never depends on them. */
  async function refreshContinuity(threadId?: string) {
    if (!continuity) return;
    try {
      const body = await requestJson<{ relations: Array<ThreadRelation & { threadId: string }>; outcomes: ThreadOutcome[] }>(`${continuityEndpoint(slug)}${threadId ? `?threadId=${encodeURIComponent(threadId)}` : ""}`, { cache: "no-store" });
      if (!alive.current) return;
      setRelations(body.relations); setOutcomes(body.outcomes);
    } catch { /* the relation note and outcome list are secondary */ }
  }
  /** An organizer's answer to "which task?": their original message with the chosen task, saved as one ordinary turn. */
  async function chooseTask(choice: { text: string; explicitAction: NonNullable<TurnCommand["explicitAction"]> }) {
    if (working || blocked || conflict) return;
    await sendMessage(choice.text, "text", undefined, { explicitAction: choice.explicitAction });
  }
  async function startSuggestedTask(title: string, query: string) {
    if (!selectedThreadId) return;
    const result = await runTaskOperation(slug, { op: "start", commandId: crypto.randomUUID(), threadId: selectedThreadId, title, query, brief: title });
    setNotice(result.ok ? `Started “${result.task.title}”. You can keep talking here.` : result.refusal.message);
  }
  async function openCreatedSubthread(threadId: string) {
    setSubthreadOpen(false);
    try { const next = await loadThread(threadId); openThread(threadId, next); void refreshContinuity(threadId); }
    catch (cause) { showFailure(cause, "The subthread was started, but it couldn’t be opened. Choose it on the Trip board."); }
  }
  async function startIdeaGoal(idea: TripIdea) {
    if (blocked || busy || conflict) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const created = continuity && mainThreadId ? await loadThread(mainThreadId) : CoordinatorThreadSchema.parse(await requestJson(threadsEndpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: crypto.randomUUID(), commandId: crypto.randomUUID(), title: idea.title.slice(0, 120) }) }));
      const threadId = created.activeThreadId;
      const summary = created.threads.find(item => item.id === threadId);
      if (!threadId || !summary) throw new Error("That Trip board thread couldn’t be opened.");
      const linked = CoordinatorThreadSchema.parse(await requestJson(threadsEndpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ threadId, itineraryItemId: idea.id, action: "link", expectedThreadVersion: summary.version, commandId: crypto.randomUUID() }) }).catch(cause => { throw new Error(cause instanceof CoordinatorRequestError && cause.error.userMessage ? `The thread started, but the Plan idea couldn’t be linked. ${cause.error.userMessage}` : "The thread started, but the Plan idea couldn’t be linked."); }));
      openThread(threadId, linked);
    } catch (cause) { showFailure(cause, "That Trip board thread couldn’t be started."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  /** Ask the group: the explicit poll workflow. Its first message goes to /turns with the ask_group action. */
  function startQuestionTopic(id: CoordinatorStarterId | null = null) {
    if (blocked || busy || conflict) return;
    onActivate?.();
    newThreadId.current = null; firstNewCommand.current = null;
    setLive(value => value?.originKind === "new" ? { ...value, detached: true } : value);
    go({ startingQuestion: true, startingThread: false, starterId: id });
    writeLocation();
    setPane("conversation");
    requestAnimationFrame(() => { const scroller = persistent ? conversationScroller() : messages.current; if (scroller) scroller.scrollTop = 0; composer.current?.focus(); });
  }
  /** New thread: an ordinary conversation with the coordinator. No poll draft is created by starting it. */
  function startNewConversation() {
    if (blocked || busy || conflict) return;
    onActivate?.();
    newThreadId.current = null; firstNewCommand.current = null;
    setLive(value => value?.originKind === "new" ? { ...value, detached: true } : value);
    go({ startingThread: true, startingQuestion: false, starterId: null });
    writeLocation();
    setPane("conversation");
    requestAnimationFrame(() => { const scroller = persistent ? conversationScroller() : messages.current; if (scroller) scroller.scrollTop = 0; composer.current?.focus(); });
  }
  function toggleBoard() {
    if (pane === "work") {
      setPane("conversation");
      setWorkCollapsed(true);
      setBoardCollapsed(false);
      window.localStorage.setItem(`commons:${slug}:workspace-work`, "collapsed");
      window.localStorage.setItem(`commons:${slug}:workspace-board`, "expanded");
      return;
    }
    setBoardCollapsed(value => {
      const next = !value;
      window.localStorage.setItem(`commons:${slug}:workspace-board`, next ? "collapsed" : "expanded");
      return next;
    });
  }
  function boardThread(value: string, title: string, detail: string, role?: "main" | "sub" | "task") {
    return <button key={value} className="workspace-thread" data-role={role} aria-pressed={!showOverview && effectiveSelected === value} disabled={busy || blocked || conflict} onClick={() => void discuss(value)}>
      <span className="workspace-thread-title">{title}</span><span className="workspace-thread-meta">{detail}{!showOverview && effectiveSelected === value ? " · Selected" : ""}</span>
    </button>;
  }
  function savedThread(turn: CoordinatorThread["turns"][number], archived = false) {
    return <div className="workspace-thread-row" key={turn.id}>
      {boardThread(`note:${turn.id}`, turn.userText, archived ? "Archived topic" : "Saved topic")}
      <button type="button" className="workspace-thread-action" disabled={busy || blocked || conflict} onClick={() => void action(turn.id, archived ? "unarchive" : "archive")} aria-label={`${archived ? "Restore" : "Archive"} ${turn.userText}`} title={archived ? "Restore topic" : "Archive topic"}>{archived ? "Restore" : "Archive"}</button>
    </div>;
  }
  function resourceThread(resourceType: "draft" | "poll", id: string, title: string, detail: string, archived = false) {
    return <div className="workspace-thread-row" key={`${resourceType}:${id}`}>
      {boardThread(`${resourceType}:${id}`, title, archived ? `Archived ${resourceType}` : detail)}
      <button type="button" className="workspace-thread-action" disabled={busy || blocked || conflict} onClick={() => void archiveResource(resourceType, id, archived)} aria-label={`${archived ? "Restore" : "Archive"} ${title}`} title={archived ? "Restore topic" : "Archive topic"}>{archived ? "Restore" : "Archive"}</button>
    </div>;
  }
  function goalThread(goal: CoordinatorThread["threads"][number]) {
    const archived = goal.status === "archived";
    const kind = continuity ? relationOf(goal.id)?.kind : undefined;
    return <div className="workspace-thread-row" key={goal.id}>
      {boardThread(`thread:${goal.id}`, goal.id === mainThreadId ? "Coordinator" : goal.title, archived ? "Archived goal" : kind === "main" ? "Main conversation" : kind === "sub" ? "Subthread" : goal.pollCount ? "Poll" : goal.draftCount ? "Draft" : "Exploring", kind)}
      {kind === "main" ? <span /> : <button type="button" className="workspace-thread-action" disabled={busy || blocked || conflict} onClick={() => void updateGoal(goal.id, goal.version, archived ? "active" : "archived")} aria-label={`${archived ? "Restore" : "Archive"} ${goal.title}`} title={archived ? "Restore thread" : "Archive thread"}>{archived ? "Restore" : "Archive"}</button>}
    </div>;
  }
  // The main conversation is the front door, so it comes first on the board; every other thread keeps its order.
  const activeGoals = thread.threads.filter(goal => goal.status === "active").sort((a, b) => Number(b.id === mainThreadId) - Number(a.id === mainThreadId));
  const archivedGoals = thread.threads.filter(goal => goal.status === "archived");
  const savedThreads = thread.turns.filter(turn => !turn.threadId && turn.workspace?.saved && !turn.workspace.archivedAt);
  const archivedThreads = thread.turns.filter(turn => !turn.threadId && turn.workspace?.saved && turn.workspace.archivedAt);
  const legacyDrafts = editable.filter(draft => !draft.threadId);
  const archivedDrafts = thread.drafts.filter(draft => !draft.threadId && !draft.publishedPollId && draft.archivedAt);
  const activePolls = thread.polls.filter(poll => !poll.threadId && !poll.archivedAt);
  const archivedPolls = thread.polls.filter(poll => !poll.threadId && poll.archivedAt);
  const archiveCount = archivedGoals.length + archivedThreads.length + archivedDrafts.length + archivedPolls.length;
  const signInPath = `/c/${slug}/coordinator/${selectedThreadId ? `?thread=${encodeURIComponent(selectedThreadId)}` : ""}`;
  // The live reply shows only in the thread it was sent to (or the new conversation that is creating it), and only until its saved turn is loaded.
  const liveHere = Boolean(live && !live.detached && (live.originKind === "existing" ? selectedThreadId === live.origin && !startingThread && !startingQuestion : selectedThreadId === live.origin || (startingThread || startingQuestion))
    && !contextTurns.some(turn => turn.id === live.turnId));
  // The organizer changed the words of a message Commons never confirmed: the earlier version can still land, so say so instead of promising it didn't.
  const editedAfterUnconfirmed = Boolean(unconfirmed) && unconfirmed!.explicitAction?.kind !== "ask_group" && destinationOfCommand(unconfirmed!) === destination && prompt.trim() !== "" && prompt.trim() !== unconfirmed!.text.trim();
  const composerStatus = sending ? sending.source === "text" ? (continuity ? (queued ? "Queued. Your message sends when this reply finishes." : `Commons is replying in ${sending.title}. You can keep typing and press Send; it goes next.`) : `Commons is replying in ${sending.title}. You can keep typing; send it when this reply finishes.`) : `Commons is working on your message to ${sending.title}…` : blocked ? "Finish or save your draft edits before continuing." : !conversationAvailable ? itinerary ? "Conversation isn’t connected. You can still edit and share the itinerary." : "Conversation isn’t connected. Draft review is still available." : "";
  const sourcePicker=useRef<(()=>void)|null>(null),composerAdd=useRef<HTMLButtonElement|null>(null);
  const [composerHints,setComposerHints]=useState<Record<string,string>>({});
  const pasteGuidance=(guidance:string)=>{setComposerHints(value=>({...value,[destination]:guidance}));composer.current?.focus();};
  const helpRequest=(request:string)=>{const next=appendComposerHelp(prompt,request);if(next===null){setError("This request would exceed 30,000 characters. Shorten your draft first; nothing was replaced.");return;}setPromptFor(destination,next);setComposerHints(value=>({...value,[destination]:prompt ? "Added the request below your existing draft. Edit it before sending." : "Edit this request, then send when you’re ready."}));composer.current?.focus();};
  const recipeSuggestion = recipesEnabled && !startingQuestion ? suggestRecipe(prompt) : null;
  const commands = commandDismissed === prompt || working ? [] : slashCommandChoices(addPickerOpen ? "/add " : prompt, researchAvailable);
  const selectedCommandIndex = Math.min(commandIndex, Math.max(0, commands.length - 1));
  const [commandPosition,setCommandPosition] = useState({left:16,bottom:64,width:340,maxHeight:280});
  useEffect(()=>{
    if (!commands.length || typeof document === "undefined") return;
    const measure=()=>{const rect=composer.current?.closest(".workspace-input-bar")?.getBoundingClientRect();if(rect)setCommandPosition({left:Math.max(16,rect.left),bottom:window.innerHeight-rect.top+8,width:Math.min(rect.width,window.innerWidth-32),maxHeight:Math.max(132,Math.min(280,rect.top-16))});};
    const frame=requestAnimationFrame(measure);window.addEventListener("resize",measure);window.visualViewport?.addEventListener("resize",measure);
    const outside=(event:PointerEvent)=>{const target=event.target;if(target instanceof Element && !target.closest("#coordinator-commands") && target!==composer.current){setCommandDismissed(prompt);setAddPickerOpen(false);}};
    document.addEventListener("pointerdown",outside);
    return()=>{cancelAnimationFrame(frame);window.removeEventListener("resize",measure);window.visualViewport?.removeEventListener("resize",measure);document.removeEventListener("pointerdown",outside);};
  },[commands.length,prompt]);
  function chooseCommand(command: string) {
    setCommandIndex(0); setCommandDismissed(null);
    const kind = addRecordCommand(command);
    if (kind) { setAddPickerOpen(false); setCommandDismissed(prompt); openAddRecord(kind); return; }
    setPromptFor(destination, `${command} `); composer.current?.focus();
  }
  useEffect(() => { queuedTextSend.current = text => { void sendText(text); }; });
  useEffect(() => {
    if (!embedded) return;
    const restore = (event?: PopStateEvent) => {
      const search = new URLSearchParams(window.location.search);
      if (search.get("view") !== "coordinator") return;
      const savedPresentation = persistent ? readWorkspaceHistory(event?.state) : null;
      if (savedPresentation) { setPane(savedPresentation.surface); setExpanded(savedPresentation.expanded); }
      const id = search.get("thread");
      const value = search.get("research") ? `research:${search.get("research")}` : search.get("itinerary") ? `itinerary:${search.get("itinerary")}` : search.get("poll") ? `poll:${search.get("poll")}` : search.get("draft") ? `draft:${search.get("draft")}` : id ? `thread:${id}` : mainThreadId ? `thread:${mainThreadId}` : "new";
      const cached = threadCache.current.get(id ?? mainThreadId ?? "") ?? (!id ? mainThread : undefined);
      if (cached) { setThread(cached); go({ selected:value, startingThread:search.get("new") === "1" || value === "new", startingQuestion:search.get("ask") === "1" }); }
      else if (id) void discuss(value);
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded, mainThreadId, persistent]);
  useEffect(() => {
    if (!continuity || !selectedThreadId || embedded) return;
    const frame = requestAnimationFrame(() => { void refreshContinuity(selectedThreadId); });
    return () => cancelAnimationFrame(frame);
  }, [selectedThreadId]); // eslint-disable-line react-hooks/exhaustive-deps -- refreshContinuity reads refs and stable setters
  const composerContents = <>
    {recipeSuggestion ? <p className="workspace-recipe-suggestion"><a href={`/c/${encodeURIComponent(slug)}/${recipeSuggestion.path}`}>Use the guided recipe: {recipeSuggestion.label}</a><span> Your message stays here, and nothing is sent.</span></p> : null}

    {failure ? <div className="workspace-error" role="alert"><p>{failure.message}</p>
      {failure.code === "auth_expired" ? <a className="cm-action cm-action--primary" href={signInHref(signInPath)}>Sign in again</a> : null}
      {unconfirmed ? <button type="button" className="cm-action" disabled={working} onClick={() => void checkAgain()}>Check again</button> : null}
      {conflict ? <button type="button" className="cm-action" disabled={working || blocked} onClick={() => void reload().then(() => { setConflict(false); setError(""); }).catch(cause => showFailure(cause, "The workspace couldn’t reload. Try again."))}>Reload coordinator</button> : null}
    </div> : null}
    <div className="workspace-composer-context"><p className="workspace-destination" id="workspace-destination" role="status">To: <strong>{contextTitle}</strong>{startingQuestion ? " · You review the poll before anything is shared" : ""}</p></div>
    <div className="workspace-input-bar">
      {commands.length ? <div className="workspace-command-list" style={commandPosition} id="coordinator-commands" role="listbox" aria-label={addPickerOpen || prompt.toLowerCase().startsWith("/add") ? "What would you like to add?" : "Commands"}>
        {commands.map((command,index)=><button key={command.command} id={`coordinator-command-${index}`} type="button" role="option" aria-selected={index===selectedCommandIndex} onClick={()=>chooseCommand(command.command)}><span className="workspace-command-icon" aria-hidden="true">{command.command === "/add" ? <PlusIcon/> : command.command === "/poll" ? <UsersIcon/> : command.command === "/task" ? <CheckIcon/> : command.command === "/add flight" ? <CalendarIcon/> : command.command === "/add hotel" ? <HomeIcon/> : command.command === "/add transport" ? <ArrowUpIcon/> : <PinIcon/>}</span><span className="workspace-command-body"><span className="workspace-command-title"><strong>{command.label}</strong><span className="workspace-command-kind">Command</span></span><span className="workspace-command-description">{command.guidance}</span></span></button>)}
      </div> : null}
      <div className="workspace-input-main">
      <textarea aria-label="Message your coordinator" aria-describedby="workspace-destination" aria-keyshortcuts="Meta+Enter Control+Enter" aria-controls={commands.length ? "coordinator-commands" : undefined} aria-activedescendant={commands.length ? `coordinator-command-${selectedCommandIndex}` : undefined} ref={composer} id="workspace-prompt" value={prompt} onPaste={event => { if (event.clipboardData.getData("text/plain").length + prompt.length - (event.currentTarget.selectionEnd-event.currentTarget.selectionStart)>30000) {event.preventDefault();setError("Use up to 30,000 characters per itinerary. Split a longer plan before pasting it.");} }} onChange={event => { setAddPickerOpen(false); setCommandDismissed(null); setCommandIndex(0); setPromptFor(destination, event.target.value); }} onKeyDown={event => {
        if (commands.length && !event.metaKey && !event.ctrlKey) {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); const next = (selectedCommandIndex+(event.key === "ArrowDown" ? 1 : -1)+commands.length)%commands.length; setCommandIndex(next); requestAnimationFrame(()=>{if(typeof document!=="undefined")document.getElementById(`coordinator-command-${next}`)?.scrollIntoView({block:"nearest"});}); return; }
          if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.stopPropagation(); chooseCommand(commands[selectedCommandIndex].command); return; }
          if (event.key === "Escape") { event.preventDefault(); setAddPickerOpen(false); setCommandDismissed(prompt); return; }
          if (event.key === "Tab") { setAddPickerOpen(false); setCommandDismissed(prompt); }
        }
        if (assistantUiEnabled || !isSendShortcut(event)) return; event.preventDefault(); if ((!working || (continuity && sending?.source === "text" && !busy && !queued)) && !blocked && !conflict && prompt.trim()) send(); }} rows={1} maxLength={30000} disabled={!conversationAvailable || conflict} placeholder={startingThread ? `What would you like to work on with ${coordinatorName}?` : `Ask ${coordinatorName} about this…`} />
    </div>{canAttachSources ? <CoordinatorSourceAttachments key={attachmentScope} slug={slug} actorId={actorId} destination={destination} disabled={working || conflict} clearIds={clearedAttachments[attachmentScope]} onChange={onSourcesChanged} hideAttachButton pickerRef={sourcePicker} returnFocusRef={composerAdd} /> : null}
    <div className="workspace-composer-actions"><CoordinatorComposerMenu searchAvailable={researchAvailable} key={destination} buttonRef={composerAdd} disabled={!conversationAvailable || conflict} filesDisabled={!canAttachSources || working || !actorId || !sourceState} onFiles={()=>sourcePicker.current?.()} onPasteCategory={pasteGuidance} onHelp={helpRequest} onTool={(command, guidance) => { if (command === "/add") { setAddPickerOpen(true); setCommandDismissed(null); composer.current?.focus(); return; } const next = putComposerTool(latestPrompt.current.prompt, command); if (next === null) { setError("This message is too long. Shorten it before choosing a tool."); return; } setPromptFor(destination, next); pasteGuidance(guidance); }} {...(recipesEnabled ? { recipesBase: `/c/${encodeURIComponent(slug)}`, onRecipe: (href: string) => { window.location.assign(href); } } : {})} /><div className="workspace-submit-actions">
      <CoordinatorLiveConversation available={voiceAvailable} workspaceActive={active && !showOverview} disabled={working || blocked || conflict || !conversationAvailable} coordinatorName={coordinatorName} slug={slug} startReady={startVoice || voiceReady} activeThreadId={!startingQuestion && !startingThread ? selectedThreadId ?? null : null} onDelegate={delegateVoiceTurn} />
      {continuity
        // Continuity: Send stays Send, and Stop is its own control for the reply being written. A follow-up sent meanwhile waits as the one queued message.
        ? <>{sending?.source === "text" ? <button type="button" className="workspace-stop" aria-label={live ? "Stop this reply" : "Stop waiting for reply"} title="Stop this reply" disabled={live?.stopRequested} onClick={() => { if (live) void requestStop(); else abort.current?.abort(); }}><span aria-hidden="true">■</span></button> : null}
          <button className="workspace-send" aria-label={returningItinerary ? "Review returned itinerary" : pastingItinerary ? "Review pasted itinerary" : sending?.source === "text" ? `Queue message to ${coordinatorName}` : `Send message to ${coordinatorName}`} title={returningItinerary ? "Review returned itinerary" : pastingItinerary ? "Review pasted itinerary" : sending?.source === "text" ? "Send after this reply" : "Send message"} disabled={busy || sending?.source === "voice" || blocked || conflict || !conversationAvailable || !prompt.trim() || queued || Boolean(canAttachSources && (!sourceState || sourceState.blocked)) || messageTooLong || pastingItinerary && working}><ArrowUpIcon /></button></>
        : sending?.source === "text" ? <button type="button" className="workspace-send" aria-label={live ? "Stop this reply" : "Stop waiting for reply"} title="Stop" disabled={live?.stopRequested} onClick={() => { if (live) void requestStop(); else abort.current?.abort(); }}><span aria-hidden="true">■</span></button> : <button className="workspace-send" aria-label={returningItinerary ? "Review returned itinerary" : pastingItinerary ? "Review pasted itinerary" : `Send message to ${coordinatorName}`} title={returningItinerary ? "Review returned itinerary" : pastingItinerary ? "Review pasted itinerary" : "Send message"} disabled={working || blocked || conflict || !conversationAvailable || !prompt.trim() || Boolean(canAttachSources && (!sourceState || sourceState.blocked)) || messageTooLong}><ArrowUpIcon /></button>}
    </div></div>
    </div>
    {assistantUiEnabled && !startingQuestion && !contextTurns.length && !liveHere && !prompt.trim() ? <div className="workspace-conversation-starters">{["Help shape our itinerary", "Review a plan I already have"].map(starter => <button key={starter} type="button" className="cm-action" disabled={working || conflict} onClick={() => { setPromptFor(destination, starter); composer.current?.focus(); }}>{starter}</button>)}</div> : null}
    {composerHints[destination] ? <p className="review-caption" role="status">{composerHints[destination]}</p> : null}
    {returningItinerary ? <p className="review-caption" role="status">This is a returned Commons itinerary. Review its changes in Work; it isn’t sent as a message.</p> : pastingItinerary ? <p className="review-caption" role="status">Review this pasted itinerary as a draft before saving or sharing it.</p> : messageTooLong ? <p className="review-caption" role="status">Split a longer message or source before sending. Nothing is truncated.</p> : null}
    {composerStatus ? <p className="review-caption" role="status">{composerStatus}</p> : null}
    {continuity && queued ? <div className="workspace-queued"><button type="button" className="cm-action" onClick={() => { queuedNext.current = null; setQueued(false); }}>Cancel queued message</button><span className="review-caption">It stays in the box until you send or clear it.</span></div> : null}
    {editedAfterUnconfirmed ? <p className="review-caption" role="status">You’ve changed this message. The earlier version wasn’t confirmed and may still appear in the thread; this one is sent as a new message.</p> : null}
    {notice ? <p className="review-caption" role="status">{notice}</p> : null}
    {voiceAvailable && prompt.trim() ? <p className="review-caption">Your typed message stays here. Voice doesn’t send it.</p> : null}
  </>;
  const composerForm = assistantUiEnabled ? <CommonsComposerForm text={prompt} fallback={send} canSend={(!working || Boolean(continuity && sending?.source === "text" && !busy && !queued)) && !blocked && !conflict && conversationAvailable && (!canAttachSources || Boolean(sourceState && !sourceState.blocked)) && Boolean(prompt.trim())}>{composerContents}</CommonsComposerForm> : <form className="review-composer" onSubmit={event => { event.preventDefault(); send(); }}>{composerContents}</form>;
  function togglePrototypeTask(id: string) {
    setTrackedTasks(value => value.includes(id) ? value.filter(item => item !== id) : [...value, id]);
  }
  // Overview is a sibling destination; the hidden workspace retains its controllers and drafts.
  const overviewContent = typeof overview === "function" ? overview({ goals: goalController.goals, legacyTasks: legacyOverview.tasks, tasksLoading: legacyOverview.loading, tasksUnavailable: Boolean(goalController.error) || legacyOverview.unavailable, openTodo: id => { activateConversation();setBoardCollapsed(false);setPane("tasks");requestAnimationFrame(()=>{const task=document.getElementById(`trip-todo-${id}`) as HTMLDetailsElement|null;if(task){task.open=true;task.scrollIntoView({block:"nearest"});task.querySelector<HTMLElement>("summary")?.focus();}}); }, openTask: id => { if (blocked || busy || conflict) return; void discuss(`thread:${id}`).then(() => { if (view.current.selected !== `thread:${id}`) return; setPane("work"); setWorkCollapsed(false); requestAnimationFrame(() => draftDetails.current?.focus()); }); } }) : overview;
  const coordinatorNotices = <>
    {coordinatorPreferences ? <div className="workspace-coordinator-settings"><span>{coordinatorName} · Commons AI coordinator</span><TripCoordinatorSettings showCurrent={false} slug={slug} initial={coordinatorPreferences.settings} onChange={setPersonality}/><Link href={`/c/${slug}/coordinator/settings/`}>Trip settings</Link></div> : null}
    {coordinatorPreferences && !invitationDismissed && !thread.threads.length && !thread.polls.length && !thread.drafts.length && !thread.turns.length ? <section className="workspace-guide"><p>Want help getting started? Use the conversation below to work out one useful next step.</p><button type="button" className="cm-action" onClick={async()=>{const response=await fetch(`/api/v1/commons/${slug}/coordinator/settings`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({action:'dismiss'})}).catch(()=>null);if(response?.ok)setInvitationDismissed(true);else setError('Could not dismiss the invitation. Try again.');}}>Dismiss invitation</button></section> : null}
  </>;
  const headerMenu = <details className="workspace-header-menu"><summary aria-label="More workspace actions">•••</summary><div>{canCompareStays ? <button type="button" onClick={event => { event.currentTarget.closest("details")?.removeAttribute("open"); setStayComparisonThread(selectedThreadId!); viewWork(); }}>Compare stays</button> : null}<a href={`/c/${slug}/context/`} target="_blank" rel="noopener noreferrer">Trip context<span className="sr-only"> (opens in a new tab)</span></a><button type="button" disabled={busy || blocked} onClick={() => { setBusy(true); void reload().then(() => { setConflict(false); setError(""); }).catch(cause => showFailure(cause, "The workspace couldn’t reload. Try again.")).finally(() => setBusy(false)); }}>Refresh conversation</button><button type="button" disabled={working || blocked || conflict} onClick={() => startQuestionTopic()}>Ask the group</button>{portabilityEnabled && selectedThreadId ? <button type="button" disabled={working || blocked || conflict} onClick={event => { event.currentTarget.closest("details")?.removeAttribute("open"); setPortabilitySeed({ text: "", token: crypto.randomUUID() }); setImportOpen(true); viewWork(); }}>Import an itinerary</button> : null}{recipesEnabled ? <a href={`/c/${encodeURIComponent(slug)}/recipes`}>Plan with the group</a> : null}{taskContext?.organizer && actorId && selectedThreadId === mainThreadId ? <button type="button" disabled={working || blocked || conflict} onClick={event => { setCheckInRequested(true); event.currentTarget.closest("details")?.removeAttribute("open"); requestAnimationFrame(() => document.querySelector<HTMLElement>(".workspace-check-in button")?.focus()); }}>Organizer check-in</button> : null}</div></details>;
  const relationNote = continuity && selectedThreadId ? <ThreadRelationNote relation={selectedRelation} mainThreadId={mainThreadId} parentTitle={parentOfSelected?.title ?? null} creatorName={selectedThread?.createdByName ?? null} onOpen={threadId => void discuss(`thread:${threadId}`)} /> : null;
  const conversationBody = <>
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Independent scroll regions must be keyboard-scrollable. */}
        <div ref={messages} className="workspace-messages" tabIndex={0} aria-label="Conversation history" onScroll={event => {
          if (conversationScroller() !== event.currentTarget) return;
          retainedTop.current = event.currentTarget.scrollTop;
          pinned.current = atBottom(event.currentTarget); if (pinned.current) setShowJump(false);
        }}>
          {active && !showOverview && taskContext?.organizer && actorId && selectedThreadId === mainThreadId && !startingQuestion && !startingThread ? <OrganizerGettingStarted key={`${taskContext.commons.id}:${actorId}:${checkInRequested}`} slug={slug} actorId={actorId} context={taskContext} autoStart={!contextTurns.length} reopen={checkInRequested} onClose={() => { setCheckInRequested(false); requestAnimationFrame(() => document.querySelector<HTMLElement>(".workspace-header-menu summary")?.focus()); }} /> : null}
          {brainEnabled && selectedThreadId === mainThreadId ? <CoordinatorBrain slug={slug} enabled={brainEnabled} onTodo={() => { setBoardCollapsed(false); setPane("tasks"); }} onTask={id => { void goalController.refresh().then(async()=>{const response=await fetch(`/api/v1/commons/${slug}/goals`,{cache:"no-store"});const data=await response.json() as {goals:Array<{goalId:string;threadId:string}>};const goal=data.goals.find(g=>g.goalId===id);if(goal){await reload();void openFromTasks(`thread:${goal.threadId}`);}}); }} /> : null}
          {goalsEnabled && selectedThreadId === mainThreadId ? <GoalMainReports reports={goalController.reports} onOpen={id => { void reload().then(() => discuss(`thread:${id}`)); }} /> : null}
          {goalsEnabled && actorId && selectedThreadId === mainThreadId ? <ResearchWorkspace key={`research-main:${mainThreadId}:${actorId}`} slug={slug} actorId={actorId} disabled={busy || blocked || conflict} intro={thread.turns.length ? "link" : "card"}
            onStarted={() => { void goalController.refresh(); void reload(); }}
            onQuestion={question => { if (!prompt.trim()) setPromptFor(destination, `About the research question “${question}”: `); requestAnimationFrame(() => composer.current?.focus()); }} /> : null}
          {goalsEnabled && actorId && goalController.goals.find(g => g.threadId === selectedThreadId && g.kind === "research") ? <ResearchWorkspace key={`research-goal:${selectedThreadId}:${actorId}`} slug={slug} actorId={actorId} goalId={goalController.goals.find(g => g.threadId === selectedThreadId)!.goalId}
            onQuestion={question => { if (!prompt.trim()) setPromptFor(destination, `About the research question “${question}”: `); requestAnimationFrame(() => composer.current?.focus()); }} /> : null}
          {thread.hasEarlier ? <button className="cm-action" disabled={busy} onClick={() => void earlier()}>Load earlier messages</button> : null}
          {!assistantUiEnabled && !artifact && !startingQuestion && !selectedPoll?.itinerary ? <button type="button" className="cm-action" disabled={working || blocked || conflict} onClick={()=>void startItinerary()}>Work on an itinerary</button> : null}
          {!showPreparedItinerary && artifact && itinerary ? <ItineraryOrganizerActions key={artifact.id} slug={slug} draft={artifact} publicId={selectedPoll?.publicId} restricted={selectedPoll?.audienceRestricted} disabled={working || blocked || itineraryDirty || conflict} viewDisabled={working || conflict} proposalPending={Boolean(itineraryProposal)} onBusy={setBusy} onChanged={async pollId => {
            const origin = selected;
            const next = artifact.threadId ? await loadThread(artifact.threadId) : CoordinatorThreadSchema.parse(await requestJson(endpoint,{cache:"no-store"}));
            if (!alive.current) return;
            merge(next);
            if (view.current.selected !== origin) return;
            const selection = `poll:${pollId}`;
            go({selected:selection,startingThread:false,startingQuestion:false}); writeLocation(artifact.threadId ?? undefined,selection); setShowItineraryResults(false);
          }} onReopened={async draft => {
            const origin = selected;
            const next = artifact.threadId ? await loadThread(artifact.threadId) : CoordinatorThreadSchema.parse(await requestJson(endpoint,{cache:"no-store"}));
            if (!alive.current) return;
            merge(next);
            if (view.current.selected !== origin) return;
            const selection = `draft:${draft.id}`;
            go({selected:selection,startingThread:false,startingQuestion:false}); writeLocation(artifact.threadId ?? undefined,selection); setShowItineraryResults(false); setPane("work");
          }} onView={results=>{setShowItineraryResults(results);setWorkCollapsed(false);setPane("work");}}/> : null}
          {startingQuestion ? <section className="workspace-guide" aria-label="Start with your coordinator"><span className="review-coordinator"><CoordinatorMark aria-hidden="true" /> {coordinatorName}</span><p>{starterId ? coordinatorStarter(starterId).opening(tripFacts) : "What are you trying to ask the group?"}</p><div className="workspace-starters">{coordinatorStarters.map(starter => <button key={starter.id} type="button" className="cm-action" aria-pressed={starterId === starter.id} disabled={busy || blocked || conflict} onClick={() => startQuestionTopic(starter.id)}>{starter.label}</button>)}</div><p className="review-caption">Start here or write below. We’ll shape a message and poll you can review before publishing.</p></section> : startingThread ? <section className="workspace-guide" aria-label="Start with your coordinator"><span className="review-coordinator"><CoordinatorMark aria-hidden="true" /> {coordinatorName}</span><p>What would you like to work on?</p><p className="review-caption">Commons starts from your saved trip details. This conversation is shared with the trip’s organizers only. Invitations send only when you ask, and polls start with Ask the group.</p><div className="workspace-starters" role="group" aria-label="Ask the group instead"><span className="review-caption">Or ask the group:</span>{coordinatorStarters.map(starter => <button key={starter.id} type="button" className="cm-action" disabled={busy || blocked || conflict} onClick={() => startQuestionTopic(starter.id)}>{starter.label}</button>)}</div></section> : !contextTurns.length ? <p className="review-caption">{continuity && selectedThreadId === mainThreadId ? "What would help move this trip forward? Ask a question or work through the next decision. This conversation stays with the organizers." : "No discussion on this yet. Ask Commons about the selected item."}</p> : null}
          {contextTurns.map((turn, index) => {
            const status = turnStatusOf(turn), own = isOwnTurn(turn, actorId), newest = index === contextTurns.length - 1;
            const preparedPoll = status === "completed" && (turn.workspace?.pollReview || turn.workspace?.capability === "prepare_poll" && !turn.workspace.proposal) ? thread.drafts.find(draft => draft.id === (turn.workspace?.pollReview?.draftId ?? turn.draftId) && !draft.archivedAt && !itineraryQuestion(draft.data.questions)) : undefined;
            return <article className="review-turn" key={turn.id} data-turn-status={status}>{continuity && index > 0 && contextTurns[index - 1].workspace?.steering?.kind === "clarify" && contextTurns[index - 1].userText === turn.userText
              // The saved answer to "which task?" carries the original words again; they are shown once, in the message that asked.
              ? <p className="review-caption workspace-choice-note"><strong>{turn.authorName ?? "Organizer"}</strong> chose a task for the message above.</p>
              : <CommonsMessage messageId={`${turn.id}:user`}><div className="review-chat-user"><strong>{turn.authorName ?? "Organizer"}</strong><p>{turn.userText}</p></div></CommonsMessage>}<CommonsMessage messageId={`${turn.id}:assistant`}><div className="workspace-reply"><span className="review-coordinator"><CoordinatorMark aria-hidden="true" /> {coordinatorPersonalities.find(p=>p.id===(turn.workspace?.personality??"commons"))!.name}</span>
            {status === "completed" ? <>{assistantUiEnabled ? <CommonsReplyText text={turn.assistantText} /> : <p>{turn.assistantText}</p>}{turnSources(turn)}{isUnsupportedTurn(turn) ? <p className="review-caption">Commons can’t do this yet. Nothing changed.</p> : null}</> : status === "pending" ? <TurnPending own={own} onCheck={() => void checkTurn(turn)} busy={working} /> : <TurnFailed turn={turn} own={own} onRetry={() => void retryTurn(turn)} busy={working} stopped={Boolean(turn.commandId && stoppedCommands.has(turn.commandId))} />}
            {newest ? <ClarifyCandidates navigation={turn.workspace?.navigation} onOpen={threadId => void discuss(`thread:${threadId}`)} disabled={busy || blocked || conflict} /> : null}
            {turn.workspace?.pollDiscovery?.length ? <ul className="workspace-actions" aria-label="Available trip polls">{turn.workspace.pollDiscovery.map(poll=><li key={`${poll.kind}:${poll.id}`}><a className="cm-action" href={poll.kind==="draft" ? `/c/${slug}?view=coordinator&draft=${poll.id}` : `/c/${slug}/polls/${poll.id}`}>{poll.title} · {poll.kind==="draft" ? "Draft" : "Shared"}</a></li>)}</ul> : null}
            {newest && continuity && own ? <SteeringChoices steering={turn.workspace?.steering} disabled={working || blocked || conflict} onChoose={choice => void chooseTask(choice)} onStartSuggested={(title, query) => void startSuggestedTask(title, query)} /> : null}
            {turn.workspace?.invitationReview ? <section className="workspace-work-section" aria-label="Review traveler invitations"><h3>Add travelers</h3><p>Requested by {turn.authorName ?? "Organizer"}. Traveler access starts after acceptance. Attendance stays separate.</p><ul>{turn.workspace.invitationReview.map(person => <li key={person.email}>{person.displayName} · {person.email}</li>)}</ul>{newest && own ? <button type="button" className="cm-action cm-action--primary" disabled={working || blocked || conflict} onClick={() => void sendMessage(`Invite ${turn.workspace!.invitationReview!.map(person => `${person.displayName} <${person.email}>`).join(", ")}`, "text")}>Approve and invite travelers</button> : <p>Earlier review · invitations, if approved, have their own receipt.</p>}</section> : null}
            {status === "completed" && turn.workspace?.expenseReview ? <section className="workspace-work-section workspace-artifact" aria-label="Expense review"><strong>{turn.workspace.expenseReview.title}</strong><p className="review-caption">Review the actual amount and payer before recording spending.</p><a className="cm-action" href={`/c/${encodeURIComponent(slug)}?arrival=0&view=money&item=plan&itemId=${encodeURIComponent(turn.workspace.expenseReview.planId)}&convertExpense=1`} target="_blank" rel="noopener noreferrer">Review expense<span className="sr-only"> (opens in a new tab)</span></a></section> : null}
            {status === "completed" && turn.workspace?.activityReceipt ? <ul className="workspace-receipts" aria-label="Saved to Plan">{turn.workspace.activityReceipt.items.map(item => {
              // A lasting receipt per saved activity, pointing at where it actually is in Plan (its day, or No day yet).
              const saved = taskContext?.state.itinerary.find(entry => entry.id === item.id);
              const receipt = saved ? activityReceipt(slug, saved, taskContext!.commons.timezone) : null;
              return <li key={item.id}><BookmarkIcon /><span>{item.status === "existing" ? "Already in Plan" : "Saved to Plan"} · <strong>{item.title}</strong>{receipt ? ` · ${receipt.status}` : ""}</span><Link href={receipt?.href ?? `${planSectionPath(slug, "ideas")}&item=plan&itemId=${encodeURIComponent(item.id)}`}>View in Plan</Link></li>;
            })}</ul> : null}
            {turn.workspace?.attendanceReceipt ? <div className="workspace-actions">
              {turn.workspace.attendanceReceipt.undone ? <p role="status">Attendance update undone.</p> : turn.workspace.attendanceReceipt.people.length > 0 && own ? <button type="button" className="cm-action" disabled={working || blocked || conflict} onClick={() => void action(turn.id, "undo_attendance")}>Undo attendance update</button> : null}
            </div> : null}
            {turn.workspace?.proposal ? <ProposalArtifact proposal={turn.workspace.proposal} actedBy={turn.workspace.actedBy} busy={working} blocked={blocked} conflict={conflict} editable={editable} turnId={turn.id} draftId={turn.draftId} previewed={itineraryProposalTurn?.id === turn.id && reviewedItineraryProposalId === turn.id} onReview={turnId => { setItineraryProposalId(turnId); setReviewedItineraryProposalId(turnId); viewWork(); }} onAction={(turnId, kind) => void action(turnId, kind)} /> : null}
            {turn.workspace?.itineraryDraft ? <section className="workspace-artifact" aria-label="Prepared itinerary"><p>{turn.workspace.itineraryDraft.content.title} · Draft {turn.workspace.itineraryDraft.version} · Organizers only</p><button type="button" className="cm-action" onClick={() => { const selection = `itinerary:${turn.workspace!.itineraryDraft!.id}`; go({ selected: selection }); writeLocation(turn.threadId ?? undefined, selection); viewWork(); }}>Review itinerary</button></section> : null}
            {preparedPoll ? <section className="workspace-artifact" aria-label="Prepared poll"><p>{preparedPoll.data.title} · {preparedPoll.publishedPollId ? "Published" : "Organizers only"}</p><button type="button" className="cm-action" disabled={working || blocked || conflict} onClick={() => {  void discuss(`${preparedPoll.publishedPollId ? "poll" : "draft"}:${preparedPoll.publishedPollId ?? preparedPoll.id}`).then(() => viewWork()); }}>{preparedPoll.publishedPollId ? "View poll and results" : "Review poll"}</button></section> : null}
            {turn.workspace?.taskProposal ? <CoordinatorTripTask proposal={turn.workspace.taskProposal} current={turn.id === contextTurns.findLast(item => item.workspace?.taskProposal?.task.id === turn.workspace!.taskProposal!.task.id)?.id} disabled={working || blocked || conflict} slug={slug} threadId={turn.threadId} ownerName={turn.authorName ?? "Organizer"} onAction={operation => taskProposalAction(turn.id, turn.workspace!.taskProposal!.version, operation)} /> : null}
            {turn.workspace?.tripProposal ? <TripChangeArtifact key={`${turn.id}:${turn.workspace.tripProposal.version}`} proposal={turn.workspace.tripProposal} slug={slug} busy={working} blocked={blocked} conflict={conflict} turnId={turn.id} reportedBy={turn.authorName} onAction={(turnId, kind, version, changes, planContact) => void tripAction(turnId, kind, version, changes, planContact)} /> : null}
            {turn.workspace?.linkedIdea ? <div className="workspace-actions"><p className="review-caption">Linked “{turn.workspace.linkedIdea.title}” to this thread. Nothing was scheduled or approved.</p><button type="button" className="cm-action" onClick={() => viewWork()}>View linked ideas</button></div> : null}
            {dynamicPresentation && turn.id === latestUiTurn?.id ? <button className="cm-action workspace-view-work" type="button" onClick={() => { setStayComparisonThread(null); setDynamicUiThread(selectedThreadId ?? null); viewWork(true); }}>View suggested working material</button> : null}
            {turn.workspace?.research ? <button className="cm-action workspace-view-work" type="button" onClick={() => openResearch(turn.id)}>View research · {turn.workspace.research.sources.length} {turn.workspace.research.sources.length === 1 ? "source" : "sources"}</button> : null}
            {turn.workspace?.actedBy && !turn.workspace.proposal && !turn.workspace.tripProposal ? <p className="review-caption">Updated by {turn.workspace.actedBy.name}</p> : null}
            {turn.workspace && !turn.workspace.saved && !selectedThreadId ? <button className="cm-action" disabled={working || blocked || conflict} onClick={() => void action(turn.id, "save")}>Keep as a Trip board topic</button> : null}
          </div></CommonsMessage></article>;
          })}
          {persistent && selectedThreadId === mainThreadId && contextTurns.length > 0 && turnStatusOf(contextTurns[contextTurns.length - 1]) === "completed" && !working && nextSteps.length ? <nav className="workspace-next-steps" aria-label="Suggested next steps">{nextSteps.slice(0, 3).map(step => <SuggestionAction key={step.id} suggestion={step} slug={slug} context={taskContext} className="workspace-next-step" label={`${step.action} · ${step.title}`} onOpenGoal={id => { if (!busy && !blocked && !conflict) void openFromTasks(`thread:${id}`); }} onOpenPollResults={openPollResults} />)}</nav> : null}
          {thread.polls.filter(poll => poll.threadId === selectedThreadId && selectedThreadId && poll.status !== "revoked").filter((poll,index,rows)=>rows.findIndex(other=>other.id===poll.id)===index).map(poll=><SharedPollCard key={poll.id} poll={poll} slug={slug} />)}
          {liveHere ? <LiveTurn turn={live!} /> : null}
          {continuity && selectedThreadId === mainThreadId ? <LinkedOutcomes outcomes={outcomes} onOpen={threadId => void discuss(`thread:${threadId}`)} /> : null}
          {prototypeInspector ? <section className="workspace-reference-preview" aria-label="Flight research reference"><div><span className="review-caption">FLIGHT RESEARCH</span><strong>Denver → San Francisco</strong><p>United 1189 · 8:05 AM–9:48 AM</p><small>Reference only · Fare and availability may change</small></div><div><button type="button" className="cm-action" onClick={() => setInspectorOpen(true)}>View source</button><button type="button" className="cm-action" onClick={() => setInspectorOpen(true)}>{trackedTasks.length} {trackedTasks.length === 1 ? "task" : "tasks"}</button></div></section> : null}
        </div>
        {showJump ? <button type="button" className="cm-action workspace-jump" onClick={scrollToLatest}>Jump to latest</button> : null}
        {continuity && selectedThreadId && subthreadOpen ? <SubthreadStarter slug={slug} parentThreadId={selectedThreadId} disabled={working || blocked || conflict} onCreated={threadId => void openCreatedSubthread(threadId)} onClose={() => { setSubthreadOpen(false); requestAnimationFrame(() => document.querySelector<HTMLElement>(".workspace-header-menu summary")?.focus()); }} /> : null}
        {composerForm}
  </>;
  const workCaption = showingDynamic ? "SAVED WORK" : comparingStays ? "SAVED OPTIONS" : selectedResearchTurn ? "EVIDENCE" : showPreparedItinerary ? "PRIVATE ITINERARY DRAFT" : artifact ? artifact.publishedPollId ? "PUBLISHED" : "DRAFT" : researchTurns.length ? "EVIDENCE" : "WORKING NOTES";
  const workTitle = showingDynamic ? "Working material" : comparingStays ? "Stay comparison" : selectedResearchTurn ? "Research & sources" : showPreparedItinerary ? "Itinerary" : itinerary ? showItineraryResults && artifact?.publishedPollId ? "Poll results" : "Itinerary" : artifact ? artifact.publishedPollId ? "Share this" : "Poll draft" : researchTurns.length ? "Research & sources" : "Working material";
  const workLabel = showingDynamic ? "Work" : showPreparedItinerary ? "Itinerary" : itinerary ? showItineraryResults && artifact?.publishedPollId ? "Results" : "Itinerary" : artifact ? artifact.publishedPollId ? "Share" : "Poll draft" : researchTurns.length ? "Research" : "Work";
  const workContent = <>
          {dynamicPresentation && dynamicCatalog && actorId && latestUiTurn ? <div hidden={!showingDynamic}><CoordinatorDynamicWork key={`${slug}:${actorId}:${selectedThreadId}`} presentation={dynamicPresentation} catalog={dynamicCatalog} actorId={actorId} turnId={latestUiTurn.id} thread={thread} onBack={() => { setDynamicUiThread(null); requestAnimationFrame(() => draftDetails.current?.focus()); }} onOpenArtifact={selection => { setDynamicUiThread(null); if (selection.startsWith("itinerary:")) { go({selected: selection}); writeLocation(selectedThreadId ?? undefined, selection); viewWork(); } else { const dismissal = workDismissal.current; void discuss(selection).then(() => { if (alive.current && view.current.selected === selection && workDismissal.current === dismissal) viewWork(); }); } }} /></div> : null}
          <div hidden={showingDynamic}>
          {goalsEnabled && goalController.goals.find(goal => goal.threadId === selectedThreadId) ? <GoalTaskDetails key={selectedThreadId} goal={goalController.goals.find(goal => goal.threadId === selectedThreadId)!} controller={goalController} polls={thread.polls} turns={contextTurns} /> : null}
        {!goalsEnabled && availableIdeas.length ? <details className="workspace-board-ideas"><summary>Activities from Plan · {availableIdeas.length}</summary><p>Turn an idea into something to work through.</p><div className="workspace-thread-list">{availableIdeas.map(idea => <button key={idea.id} type="button" className="workspace-thread workspace-thread--suggested" disabled={busy || blocked || conflict} onClick={() => void startIdeaGoal(idea)}><span className="workspace-thread-title">{idea.title}</span><span className="workspace-thread-meta">{continuity ? "Discuss with Coordinator" : "Start a thread"}</span></button>)}</div></details> : null}
          {comparingStays && taskContext && actorId && selectedThreadId ? <><button className="cm-action cm-action--quiet" type="button" onClick={() => setStayComparisonThread(null)}>Back to other working material</button><CompareStays renderer={compareStaysRenderer} key={`${slug}:${actorId}:${selectedThreadId}`} snapshot={compareStaysSnapshot(taskContext.commons, taskContext.state.stays ?? [], taskContext.state.itinerary)} actorId={actorId} threadId={selectedThreadId} /></> : null}
          <div hidden={comparingStays}>
          {!hasWork ? <p className="review-caption">Drafts, research and linked ideas for this goal will appear here.</p> : null}
          {portabilityEnabled && selectedThreadId && importOpen && !(showPreparedItinerary && reviewedItineraryTurn?.workspace?.itineraryDraft) ? <ItineraryPortabilityPanel key={selectedThreadId} slug={slug} threadId={selectedThreadId} document={null} disabled={working || blocked || conflict} seed={portabilitySeed} onApplyStart={importApplyStarted} /> : null}
          {showPreparedItinerary && reviewedItineraryTurn?.workspace?.itineraryDraft ? <CoordinatorItinerary activityDecisionsEnabled={activityDecisionsEnabled} portability={portabilityEnabled ? { seed: portabilitySeed, onApplyStart: importApplyStarted } : undefined} key={`${actorId}:${reviewedItineraryTurn.workspace.itineraryDraft.id}`} turnId={reviewedItineraryTurn.id} onSave={saveItineraryDocument} onReady={flush => { itineraryFlush.current = flush; }} actorId={actorId} sharingDraft={thread.drafts.find(draft => draft.id === reviewedItineraryTurn.workspace?.itineraryDraft?.sharingDraft?.draftId)} sharingPublicId={thread.polls.find(poll => poll.id === thread.drafts.find(draft => draft.id === reviewedItineraryTurn.workspace?.itineraryDraft?.sharingDraft?.draftId)?.publishedPollId)?.publicId} hasPublishedVersion={thread.drafts.some(row=>row.publishedPollId && row.data.privateItineraryDocument?.id === reviewedItineraryTurn.workspace?.itineraryDraft?.id)} latestPublishedPollId={thread.drafts.filter(row=>row.publishedPollId && row.data.privateItineraryDocument?.id === reviewedItineraryTurn.workspace?.itineraryDraft?.id).sort((a,b)=>(b.data.privateItineraryDocument?.version ?? 0)-(a.data.privateItineraryDocument?.version ?? 0))[0]?.publishedPollId ?? undefined} onSharingChanged={async () => { await reload(); }} onOpenVote={id => {  void discuss(`draft:${id}`).then(() => { setPane("work"); setWorkCollapsed(false); }); }} draft={reviewedItineraryTurn.workspace.itineraryDraft} current={Boolean(reviewedItineraryTurn)} slug={slug} disabled={working || draftBlocked || conflict} onDirtyChange={setItineraryDirty} onAction={change => itineraryAction(reviewedItineraryTurn.id, reviewedItineraryTurn.workspace!.itineraryDraft!.version, change)} /> : null}
          {!selectedResearchTurn && !showPreparedItinerary && (itineraryProposal ? <section aria-label="Itinerary proposal preview"><p className="review-caption">Proposed version · Not applied</p><details className="workspace-proposal-preview"><summary>Compare with saved version</summary><ItineraryDocument itinerary={itinerary!.itinerary}/></details><ProposalPreview proposal={itineraryProposal}/></section> : artifact && itinerary ? artifact.publishedPollId ? showItineraryResults ? <ItineraryFeedbackResults key={artifact.publishedPollId} slug={slug} pollId={artifact.publishedPollId} showHeading={false}/> : <ItineraryDocument itinerary={itinerary.itinerary}/> : <fieldset className="review-artifact-boundary" disabled={working}><ItineraryDraftEditor key={`${actorId}:${artifact.id}:${itineraryImport?.draftId === artifact.id && itineraryImport.actorId === actorId ? itineraryImport.token : ""}`} slug={slug} actorId={actorId} draft={artifact} sourceImport={itineraryImport?.draftId === artifact.id && itineraryImport.actorId === actorId ? itineraryImport.source : undefined} onSaved={draft => { saved(draft); const recovered = actorId ? finishSavedItineraryPaste(slug,actorId,draft.id,draft.data.itinerarySource) : null; if (recovered && draft.data.itinerarySource) confirmSent(recovered,draft.data.itinerarySource); if (itineraryImport?.draftId === draft.id && itineraryImport.actorId === actorId && draft.data.itinerarySource === itineraryImport.source) { confirmSent(itineraryImport.destination, itineraryImport.source); setItineraryImport(null); } }} onBlocked={setBlocked} onDirtyChange={setItineraryDirty} onReady={flush => { legacyItineraryFlush.current = flush; }}/></fieldset> : artifact ? <section aria-label="Poll and message to share" key={`${artifact.id}:${revision}`}><fieldset className="review-artifact-boundary" disabled={busy}><CoordinatorReview inline slug={slug} initialDraft={artifact} onSaved={saved} onBlocked={artifact.publishedPollId ? () => {} : setBlocked} onPublished={async pollId => {
              trackProductEvent("poll_published");
              const origin = selected;
              const next = selectedThreadId ? await loadThread(selectedThreadId) : CoordinatorThreadSchema.parse(await requestJson(endpoint, { cache: "no-store" }));
              // Publication is already saved. Its delayed refresh must not change the pane or steal a newer destination.
              if (!alive.current) return;
              if (view.current.selected !== origin || view.current.startingThread || view.current.startingQuestion) { await refreshBoard(); return; }
              merge(next); setRevision(value => value + 1);
              if (pollId) {
                const selection = `poll:${pollId}`;
                 setShowItineraryResults(false);
                go({ selected: selection }); writeLocation(selectedThreadId ?? undefined, selection);
              }
            }} isPublishedArtifact={Boolean(artifact.publishedPollId)} publishedPublicId={selectedPoll?.publicId} publishedAudienceRestricted={selectedPoll?.audienceRestricted} /></fieldset></section> : null)}
          {!itinerary && selectedPoll && selectedPoll.responseCount > 0 ? <details className="workspace-work-section" open><summary>Poll results · {selectedPoll.responseCount} responses</summary>{selectedPoll.resultsVisible ? selectedPoll.results.map(result => <section key={result.questionId}><h3>{result.prompt}</h3>{result.formatNotice ? <p>{result.formatNotice}</p> : null}<ul>{result.options.map(option => <li key={option.optionId}>{option.label}: {option.count}</li>)}</ul>{result.textResponseCount ? <p>{result.textResponseCount} written responses</p> : null}</section>) : <p>Results are available when voting closes.</p>}<a href={`/c/${slug}/polls/${selectedPoll.id}`}>Open poll and decisions</a></details> : null}
          {initialRecommendations.filter(item => item.sourcePollId === selectedPollId).map(item => <details className="workspace-work-section" open key={item.id}><summary>Recommended next step</summary><p>{item.recommendation}</p><p className="review-caption">Prepared by {item.preparedBy} · {item.freshness}</p>{item.evidenceCurrent === false ? <p role="alert">The source poll changed. Review its current results first.</p> : null}<ul>{item.uncertainties.map(text => <li key={text}>{text}</li>)}</ul><p>{item.nextAction}</p></details>)}
          {selectedThread && (selectedThreadId !== mainThreadId || linkedIdeas.length > 0) && (!goalsEnabled || linkedIdeas.length > 0) && !artifact?.publishedPollId && (!continuity || linkedIdeas.length > 0 || availableIdeas.length > 0) ? <section className="workspace-work-section workspace-linked-ideas" aria-label="Activities linked from Plan"><div><h3>Activities from Plan</h3><p className="review-caption">References for this goal. Linking an activity does not schedule or approve it.</p></div>{linkedIdeas.length ? <ul>{linkedIdeas.map(idea => <li key={idea.id}><div><strong>{idea.title}</strong><span>{idea.status} · {idea.provenanceLabel}</span>{idea.sourceUrl ? <a href={idea.sourceUrl} target="_blank" rel="noreferrer">Open source</a> : null}</div><button type="button" className="cm-action" disabled={busy || blocked || conflict} onClick={() => void linkIdea(idea.itineraryItemId, "unlink")}>Remove</button></li>)}</ul> : <p>No activities linked yet.</p>}{!goalsEnabled && availableIdeas.length ? <details><summary>Add from Plan</summary><div className="workspace-idea-choices">{availableIdeas.map(idea => <button key={idea.id} type="button" className="cm-action" disabled={busy || blocked || conflict} onClick={() => void linkIdea(idea.id, "link")}><span>{idea.title}</span><small>{idea.status}</small></button>)}</div></details> : null}</section> : null}
          {selectedResearchTurn?.workspace?.research ? researchRunView(selectedResearchTurn.workspace.research, selectedResearchTurn.id, "Saved in this conversation") : null}
          {!selectedResearchTurn && !showPreparedItinerary && !artifact && legacyResearchTurns.map(turn => turn.workspace?.research ? researchRunView(turn.workspace.research, turn.id, "Saved in this conversation") : null)}
          {durableResearchAvailable && selectedThreadId && !continuity ? <CoordinatorResearchTasks key={selectedThreadId} runnerOperating={runnerOperating} slug={slug} threadId={selectedThreadId} onComplete={() => {
              void fetch(`${endpoint}?threadId=${encodeURIComponent(selectedThreadId)}`, { cache: "no-store" }).then(async response => {
                if (!response.ok) throw new Error("Research could not reload.");
                const next = CoordinatorThreadSchema.parse(await response.json());
                setThread(current => current.activeThreadId === selectedThreadId ? { ...current, researchRuns: next.researchRuns } : current);
              }).catch(() => setError("Research finished, but sources could not reload. Reload the workspace."));
            }} /> : null}
          {!selectedResearchTurn && !showPreparedItinerary && !artifact && researchRuns.map(run => researchRunView(run, run.id, `Run by ${run.createdByName}${taskRuns.all.has(run.id) && !taskRuns.current.has(run.id) ? " · Out of date: the task brief changed after this ran" : ""}`))}
          </div>
          </div>
  </>;
  // ---- Persistent layout (layout="persistent"): Work left, conversation right, a Conversations selector and Tasks in Work. Presentation around the same controller. ----
  const tasksTitle = continuity || goalsEnabled ? "Tasks" : "Trip board";
  const goalDetailsOpen = Boolean(goalsEnabled && goalController.goals.some(goal => goal.threadId === selectedThreadId));
  // The main conversation alone is not working material; the restore action appears only when there is something to open.
  const bareMainConversation = Boolean(selectedThread && selectedThreadId === mainThreadId) && !(dynamicPresentation || comparingStays || artifact || selectedPoll || researchTurns.length || researchRuns.length || linkedIdeas.length || goalDetailsOpen || initialRecommendations.some(item => item.sourcePollId === selectedPollId));
  const meaningfulWork = hasWork && !bareMainConversation;
  const goalDetail = (goal: CoordinatorThread["threads"][number]) => {
    const kind = continuity ? relationOf(goal.id)?.kind : undefined;
    return goal.status === "archived" ? "Archived goal" : kind === "main" ? "Main conversation" : kind === "sub" ? "Subthread" : goal.pollCount ? "Poll" : goal.draftCount ? "Draft" : "Exploring";
  };
  const goalChoice = (goal: CoordinatorThread["threads"][number]) => {
    const archived = goal.status === "archived", kind = continuity ? relationOf(goal.id)?.kind : undefined;
    return { value: `thread:${goal.id}`, title: goal.id === mainThreadId ? "Coordinator" : goal.title, detail: goalDetail(goal),
      action: kind === "main" ? undefined : { label: archived ? "Restore" : "Archive", ariaLabel: `${archived ? "Restore" : "Archive"} ${goal.title}`, run: () => void updateGoal(goal.id, goal.version, archived ? "active" : "archived") } };
  };
  const resourceChoice = (resourceType: "draft" | "poll", id: string, title: string, detail: string, archived = false) => ({
    value: `${resourceType}:${id}`, title, detail: archived ? `Archived ${resourceType}` : detail,
    action: { label: archived ? "Restore" : "Archive", ariaLabel: `${archived ? "Restore" : "Archive"} ${title}`, run: () => void archiveResource(resourceType, id, archived) },
  });
  const noteChoice = (turn: CoordinatorThread["turns"][number], archived = false) => ({
    value: `note:${turn.id}`, title: turn.userText, detail: archived ? "Archived topic" : "Saved topic",
    action: { label: archived ? "Restore" : "Archive", ariaLabel: `${archived ? "Restore" : "Archive"} ${turn.userText}`, run: () => void action(turn.id, archived ? "unarchive" : "archive") },
  });
  const plainBoard = !continuity && !goalsEnabled;
  const taskThread = (goal: CoordinatorThread["threads"][number]) => goalsEnabled && goalController.goals.some(task => task.threadId === goal.id);
  const selectorGroups: ContextGroup[] = [
    { id: "current", label: continuity ? "Main conversation" : "Conversations", choices: [
      ...(continuity ? activeGoals.filter(goal => goal.id === mainThreadId) : activeGoals).map(goalChoice),
      ...(plainBoard ? [...legacyDrafts.map(draft => resourceChoice("draft", draft.id, draft.data.title, "Poll draft")), ...activePolls.map(poll => resourceChoice("poll", poll.id, poll.title, `${poll.status === "open" ? "Open poll" : "Closed poll"} · ${poll.responseCount} responses`)), ...savedThreads.map(turn => noteChoice(turn))] : []),
    ] },
    { id: "earlier", label: "Earlier conversations", choices: goalsEnabled || continuity ? [
      ...(continuity ? activeGoals.filter(goal => goal.id !== mainThreadId && !taskThread(goal)).map(goalChoice) : []),
      ...legacyDrafts.map(draft => resourceChoice("draft", draft.id, draft.data.title, "Poll draft")), ...activePolls.map(poll => resourceChoice("poll", poll.id, poll.title, "Poll")), ...savedThreads.map(turn => noteChoice(turn)),
    ] : [] },
    { id: "archived", label: "Archived", choices: [
      ...archivedGoals.map(goalChoice), ...archivedDrafts.map(draft => resourceChoice("draft", draft.id, draft.data.title, "Poll draft", true)),
      ...archivedPolls.map(poll => resourceChoice("poll", poll.id, poll.title, "Poll", true)), ...archivedThreads.map(turn => noteChoice(turn, true)),
    ] },
  ];
  const tasksContent = <>
    <TripTasks onSuggestions={setNextSteps} onOpenGoal={id => { if (!busy && !blocked && !conflict) void openFromTasks(`thread:${id}`); }} onOpenPollResults={openPollResults} slug={slug} actorId={actorId} context={taskContext ? { ...taskContext, goals: goalController.error ? [] : goalController.goals } : undefined} />
    {goalsEnabled && mainThreadId ? <GoalTaskRail heading="Coordinator tasks" showCoordinator={false} controller={goalController} slug={slug} actorId={actorId} mainThreadId={mainThreadId} selectedThreadId={showOverview ? null : selectedThreadId ?? null} disabled={busy || blocked || conflict} ideas={availableIdeas} onOpen={id => { void reload().then(() => openFromTasks(`thread:${id}`)); }} /> : null}
    {continuity && !goalsEnabled && selectedThreadId && (!assistantUiEnabled || durableResearchAvailable) ? <CoordinatorTaskPanel label="Research tasks" key={selectedThreadId} slug={slug} threadId={selectedThreadId} threadKind={selectedRelation?.kind ?? "topic"} initialCapability={continuity.capability} disabled={blocked || conflict}
      onTasks={tasks => { setTaskRuns({ current: new Set(tasks.flatMap(task => task.currentRunId ? [task.currentRunId] : [])), all: new Set(tasks.flatMap(task => task.runIds)) }); }}
      onViewResult={viewWork} onOutcomeLinked={() => void refreshContinuity(selectedThreadId)}
      onFinished={() => { void fetch(`${endpoint}?threadId=${encodeURIComponent(selectedThreadId)}`, { cache: "no-store" }).then(async response => { if (!response.ok) throw new Error("Research could not reload."); const next = CoordinatorThreadSchema.parse(await response.json()); setThread(current => current.activeThreadId === selectedThreadId ? { ...current, researchRuns: next.researchRuns } : current); }).catch(() => setError("A task finished, but its sources couldn’t reload. Reload the workspace.")); }} /> : null}
    {plainBoard && !thread.polls.length && !thread.drafts.length ? <p className="review-caption">Polls and drafts appear under Conversations as you work through the trip.</p> : null}
  </>;
  const closeLabel = mode === "split" ? "Close working material" : "Back to conversation";
  // One slim bar: the conversation title is the switcher and Tasks is an icon.
  // The whole workspace is organizer-only, so that says nothing here; artifacts keep their own private/shared labels. Only a subthread's parent is worth a line.
  const scopeLine = selectedRelation?.kind === "sub" ? `Subthread${parentOfSelected?.title ? ` of ${parentOfSelected.title}` : ""}` : null;
  const persistentConversationHeader = <header className="workspace-panel-heading workspace-conversation-heading workspace-conversation-heading--slim">
    <div className="workspace-conversation-title">
      <CoordinatorContextSelector variant="title" groups={selectorGroups} selected={effectiveSelected} currentTitle={contextTitle} disabled={busy || blocked || conflict} onChoose={value => void discuss(value)} onNew={plainBoard ? () => startNewConversation() : undefined} />
      {scopeLine ? <p className="workspace-conversation-scope">{scopeLine}</p> : null}
    </div>
    <div className="workspace-context-controls">
      {meaningfulWork && !(workOpen && pane === "work") ? <button ref={workToggle} type="button" className="cm-action workspace-work-restore" aria-label={`Open ${workLabel.toLowerCase()}`} title="Open working material" aria-controls="workspace-working-pane" onClick={restoreWork}>{workLabel}</button> : null}
      <button ref={tasksToggle} type="button" className="workspace-icon-action workspace-tasks-toggle" aria-label={tasksTitle} title={tasksTitle} aria-pressed={workOpen && pane === "tasks"} aria-controls="workspace-working-pane" onClick={toggleTasks}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11" /><path d="m3.5 6 1.5 1.5L7.5 5M3.5 12l1.5 1.5L7.5 11M3.5 18l1.5 1.5 2.5-2.5" /></svg>
      </button>
      {headerMenu}
    </div></header>;
  const conversationSection = <section className="workspace-chat workspace-panel" aria-label="Your coordinator">
    {persistentConversationHeader}
    {selectedRelation?.kind === "sub" && selectedRelation.brief ? <details className="workspace-relation-brief"><summary>Starting brief{selectedThread?.createdByName ? ` · by ${selectedThread.createdByName}` : ""}</summary><p>{selectedRelation.brief}</p></details> : null}
    {coordinatorNotices}
    {conversationBody}
  </section>;
  const workAside = <aside ref={draftDetails} tabIndex={-1} className="workspace-work workspace-panel" id="workspace-working-pane" aria-label={pane === "tasks" ? tasksTitle : "Working material"}>
    <header className="workspace-work-heading workspace-work-heading--persistent">
      {mode === "work" || mode === "full" ? <button type="button" className="cm-action workspace-work-back" onClick={closeWork}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg><span>{closeLabel}</span></button> : null}
      <div className="workspace-work-heading-title"><h2>{pane === "tasks" ? tasksTitle : workTitle}</h2></div>
      <div className="workspace-work-actions">
        {(mode === "split" || mode === "full") && splitFits ? <button type="button" className="workspace-work-collapse" aria-pressed={expanded} aria-label={expanded ? "Back to split view" : "Expand working material"} title={expanded ? "Back to split view" : "Expand working material"} onClick={() => setExpanded(value => !value)}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{expanded ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}</svg>
        </button> : null}
        {mode === "split" ? <button type="button" className="workspace-work-collapse" aria-label="Close working material" title="Close working material" onClick={closeWork}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button> : null}
      </div>
    </header>
    <div className="workspace-tasks-scroll" ref={tasksScroll} hidden={pane !== "tasks"} inert={pane !== "tasks"}>{tasksContent}</div>
    <div className="workspace-work-scroll" ref={materialScroll} hidden={pane === "tasks"} inert={pane === "tasks"}>{workContent}</div>
  </aside>;
  const persistentLayout = <>
    {overview ? <section className="trip-overview" hidden={!showOverview}>{overviewContent}</section> : null}
    <section hidden={showOverview} data-analytics-exclude={/^QA(?:\s|[—:-])/i.test(eventName) || prototypeInspector ? "true" : undefined} data-layout="persistent" data-mode={mode} className="coordinator-review coordinator-workspace coordinator-workspace--persistent" aria-label={`${eventName} workspace`}>
      <div className="review-layout workspace-persistent-body">
        <WorkspacePaneLayout work={workAside} conversation={conversationSection} workOpen={workOpen} expanded={expanded} ratio={workRatio} onRatioChange={changeRatio} onRatioReset={resetRatio} onFitChange={setSplitFits} workId="workspace-working-slot" />
      </div>
    </section>
  </>;
  const legacyLayout = <>
      {overview ? <section className="trip-overview" hidden={!showOverview}>{overviewContent}</section> : null}
    <main hidden={showOverview} data-analytics-exclude={/^QA(?:\s|[—:-])/i.test(eventName) || prototypeInspector ? "true" : undefined} className={`coordinator-review coordinator-workspace coordinator-workspace--two-column${embedded ? " coordinator-workspace--embedded" : ""}${continuity ? " coordinator-workspace--continuous" : ""}${prototypeInspector ? " coordinator-workspace--prototype" : ""}`} aria-label={`${eventName} workspace`}>
    {!embedded ? <GlobalNavigation accountInNavigation busy={working || blocked} onNavigate={href => router.push(href)} tab="workspace" setTab={view => { if (!working && !blocked) router.push(commonsViewPath(slug, view)); }} actorName={actorName} actorInitials={actorName.split(/\s+/).map(part => part[0]).slice(0, 2).join("")} signedIn commonsId={slug} commonsSlug={slug} canUseWorkspace /> : null}
    {coordinatorNotices}
    <div className={`workspace-switch${embedded ? " workspace-switch--trip" : ""}`} aria-label="Choose a workspace view"><button className="cm-action" aria-pressed={pane === "tasks"} onClick={() => { workDismissal.current += 1; setPane("tasks"); }}>{continuity || goalsEnabled ? "Tasks" : "Trip board"}</button><button className="cm-action" aria-pressed={!showOverview && pane === "conversation"} onClick={() => { workDismissal.current += 1; activateConversation(); setPane("conversation"); }}>Conversation</button><button className="cm-action" aria-pressed={pane === "work"} disabled={!hasWork} onClick={restoreWork}>{workLabel}</button></div>
    <div className="review-layout workspace-columns" data-itinerary={(itinerary || showPreparedItinerary) && pane === "work" && !showOverview ? "open" : "closed"} data-mode="coordinator" data-pane={pane === "tasks" ? "plan" : pane} data-board={navigationCollapsed ? "collapsed" : "expanded"} data-work={workCollapsed ? "collapsed" : "expanded"} data-has-work={hasWork ? "true" : "false"} data-inspector={prototypeInspector && inspectorOpen ? "open" : "closed"}>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Independent scroll regions must be keyboard-scrollable. */}
      <section className="workspace-plan workspace-panel" aria-label={continuity || goalsEnabled ? "Trip navigation" : "Trip board and key moments"} tabIndex={0}>
        <header className="workspace-panel-heading"><div className="workspace-board-heading"><button type="button" className="workspace-collapse" aria-label={navigationCollapsed ? (continuity || goalsEnabled ? "Show navigation" : "Show Trip board") : (continuity || goalsEnabled ? "Hide navigation" : "Hide Trip board")} aria-expanded={!navigationCollapsed} title={navigationCollapsed ? (continuity || goalsEnabled ? "Show navigation" : "Show Trip board") : (continuity || goalsEnabled ? "Hide navigation" : "Hide Trip board")} onClick={toggleBoard}><span aria-hidden="true">{navigationCollapsed ? "›" : "‹"}</span></button><button className="workspace-start-thread" aria-label="Start something new" hidden={goalsEnabled || Boolean(continuity)} onClick={() => startNewConversation()} disabled={busy || blocked || conflict}><span aria-hidden="true">+</span> New thread</button></div></header>
        <div className="workspace-thread-list">
          {continuity ? activeGoals.filter(goal => goal.id === mainThreadId).map(goal => goalThread(goal)) : activeGoals.map(goal => goalThread(goal))}
          {!continuity && !goalsEnabled && legacyDrafts.map(draft => resourceThread("draft", draft.id, draft.data.title, "Poll draft"))}
          {!continuity && !goalsEnabled && activePolls.map(poll => resourceThread("poll", poll.id, poll.title, `${poll.status === "open" ? "Open poll" : "Closed poll"} · ${poll.responseCount} responses`))}
          {!continuity && !goalsEnabled && savedThreads.map(turn => savedThread(turn))}
        </div>

        <TripTasks onOpenGoal={id=>{if (!busy && !blocked && !conflict) void discuss(`thread:${id}`);}} onOpenPollResults={id=>{void discuss(`poll:${id}`).then(()=>{setShowItineraryResults(true);setPane("work");setWorkCollapsed(false);});}} slug={slug} actorId={actorId} context={taskContext ? {...taskContext, goals: goalController.error ? [] : goalController.goals} : undefined} />
          {goalsEnabled && mainThreadId ? <GoalTaskRail showCoordinator={false} controller={goalController} slug={slug} actorId={actorId} mainThreadId={mainThreadId} selectedThreadId={showOverview ? null : selectedThreadId ?? null} disabled={busy || blocked || conflict} ideas={availableIdeas} onOpen={id => { void reload().then(() => discuss(`thread:${id}`)); }} /> : null}

        {continuity && !goalsEnabled && selectedThreadId && (!assistantUiEnabled || durableResearchAvailable) ? <CoordinatorTaskPanel label="Research tasks" key={selectedThreadId} slug={slug} threadId={selectedThreadId} threadKind={selectedRelation?.kind ?? "topic"} initialCapability={continuity.capability} disabled={blocked || conflict}
          onTasks={tasks => { setTaskRuns({ current: new Set(tasks.flatMap(task => task.currentRunId ? [task.currentRunId] : [])), all: new Set(tasks.flatMap(task => task.runIds)) }); }}
          onViewResult={viewWork} onOutcomeLinked={() => void refreshContinuity(selectedThreadId)}
          onFinished={() => { void fetch(`${endpoint}?threadId=${encodeURIComponent(selectedThreadId)}`, { cache: "no-store" }).then(async response => { if (!response.ok) throw new Error("Research could not reload."); const next = CoordinatorThreadSchema.parse(await response.json()); setThread(current => current.activeThreadId === selectedThreadId ? { ...current, researchRuns: next.researchRuns } : current); }).catch(() => setError("A task finished, but its sources couldn’t reload. Reload the workspace.")); }} /> : null}

        {(archiveCount || continuity && activeGoals.some(goal => goal.id !== mainThreadId) || (goalsEnabled || continuity) && (legacyDrafts.length || activePolls.length || savedThreads.length) || goalsEnabled && activeGoals.some(goal => !goalController.goals.some(task => task.threadId === goal.id) && goal.id !== mainThreadId)) ? <details className="workspace-archive"><summary>{goalsEnabled || continuity ? "Earlier conversations" : `Archived · ${archiveCount}`}</summary><div className="workspace-thread-list">{goalsEnabled || continuity ? activeGoals.filter(goal => goal.id !== mainThreadId && !goalController.goals.some(task => task.threadId === goal.id)).map(goal => goalThread(goal)) : null}{goalsEnabled || continuity ? <>{legacyDrafts.map(draft => resourceThread("draft", draft.id, draft.data.title, "Poll draft"))}{activePolls.map(poll => resourceThread("poll", poll.id, poll.title, "Poll"))}{savedThreads.map(turn => savedThread(turn))}</> : null}{archivedGoals.map(goal => goalThread(goal))}{archivedDrafts.map(draft => resourceThread("draft", draft.id, draft.data.title, "Poll draft", true))}{archivedPolls.map(poll => resourceThread("poll", poll.id, poll.title, "Poll", true))}{archivedThreads.map(turn => savedThread(turn, true))}</div></details> : null}
        {!continuity && !goalsEnabled && !thread.polls.length && !thread.drafts.length ? <p className="review-caption">Polls and drafts will appear here as you work through the trip.</p> : null}
      </section>
      <section className="workspace-chat workspace-panel" aria-label="Your coordinator">
        <header className="workspace-panel-heading"><div className="workspace-context-row"><div><span className="review-caption">ORGANIZERS ONLY</span><h1 className="workspace-context" aria-live="polite">{contextTitle}</h1>{relationNote}</div><div className="workspace-context-controls">{headerMenu}{hasWork ? <button ref={workToggle} type="button" className="workspace-work-collapse workspace-work-toggle" aria-label={pane === "work" ? "Close working material" : "Open working material"} title={pane === "work" ? "Close working material" : "Open working material"} aria-controls="workspace-working-pane" aria-expanded={pane === "work"} onClick={pane === "work" ? closeWork : restoreWork}><span aria-hidden="true">{pane === "work" ? "›" : "‹"}</span></button> : null}</div></div></header>
        {conversationBody}
      </section>
      <aside hidden={pane !== "work" || showOverview} ref={draftDetails} tabIndex={-1} className="workspace-work workspace-panel" id="workspace-working-pane" aria-label="Working material">
        <header className="workspace-work-heading"><button type="button" className="workspace-work-collapse" aria-label="Close working material" title="Close working material" aria-controls="workspace-working-pane" aria-expanded={pane === "work"} onClick={closeWork}><span aria-hidden="true">›</span></button><div><span className="review-caption">{workCaption}</span><h2>{workTitle}</h2></div></header>
        <div className="workspace-work-scroll">
          {workContent}
        </div>
      </aside>
      {prototypeInspector && inspectorOpen ? <aside className="workspace-inspector" aria-label="Research and tasks">
        <header><div><span className="review-caption">SELECTED REFERENCE</span><h2>Research &amp; tasks</h2></div><button type="button" className="cm-action" onClick={() => setInspectorOpen(false)}>Close</button></header>
        <div className="workspace-inspector-scroll">
          <section><p className="workspace-inspector-kicker">Flight option</p><h3>United 1189</h3><p>Denver → San Francisco</p><dl><div><dt>Departs</dt><dd>8:05 AM</dd></div><div><dt>Arrives</dt><dd>9:48 AM</dd></div><div><dt>Retrieved</dt><dd>Sep 19, 9:42 AM</dd></div></dl></section>
          <section><div className="workspace-capture"><span>Captured reference</span><strong>DEN <span aria-hidden="true">→</span> SFO</strong><p>8:05 AM&nbsp;&nbsp; UA 1189 &nbsp;&nbsp;9:48 AM</p><small>Screenshot placeholder for prototype review</small></div><a className="workspace-source-link" href="https://www.united.com/" target="_blank" rel="noreferrer">Open source on United.com <span aria-hidden="true">↗</span></a><p className="review-caption">This reference is not a live quote or booking confirmation.</p></section>
          <section className="workspace-inspector-tasks"><div><p className="workspace-inspector-kicker">Tasks</p><span className="review-caption">For trip organizers</span></div><label htmlFor="prototype-task-fare"><span className="sr-only">Confirm fare and cancellation rules before sharing this option</span><input id="prototype-task-fare" type="checkbox" checked={trackedTasks.includes("fare")} onChange={() => togglePrototypeTask("fare")} /><span aria-hidden="true"><strong>Confirm fare and cancellation rules</strong><small>Before sharing this option</small></span></label><label htmlFor="prototype-task-schedule"><span className="sr-only">Check the group’s preferred arrival time, linked to this flight research</span><input id="prototype-task-schedule" type="checkbox" checked={trackedTasks.includes("schedule")} onChange={() => togglePrototypeTask("schedule")} /><span aria-hidden="true"><strong>Check the group’s preferred arrival time</strong><small>Linked to this flight research</small></span></label></section>
        </div>
      </aside> : null}
    </div>
  </main></>;
  const layoutTree = persistent ? persistentLayout : legacyLayout;
  return assistantUiEnabled ? <CommonsAssistantRuntime key={destination} turns={contextTurns} running={Boolean(liveHere)} onSend={sendText} onStop={requestStop}>{layoutTree}</CommonsAssistantRuntime> : layoutTree;
}
