import { researchBetaFetch } from "./research-beta-budget";
import { canUseCoordinatorSearch } from "./coordinator-search-access";
import { createHash, randomUUID } from "node:crypto";
import { ItineraryDraftSchema, itineraryContentEqual, itineraryFeedbackContent, validateItineraryContent, preserveShortlists, optionCoverage, decisionScopeFor, type ItineraryDraft, type CoordinatorResearch } from "@commons/contracts";
import { scopeItineraryRefinement, preserveResearchSchedule } from "../itinerary-refinement-scope";
import { itineraryContext, readItineraryHistoryPage, associateItineraryInstruction, CoordinatorTurnError, resolveWorkflowTemplate, pinnedWorkflowReference, workflowTemplateDigest } from "@commons/database";
import { authenticatedGoalOptions } from "./polls";
import { coordinatorInferencePolicy } from "./coordinator-inference-policy";
import { coordinatorResearchEnabled, readCommonsRuntimeEnvironment, requireCommonsDatabaseUrl } from "./runtime-environment";
import { CoordinatorProviderError } from "./coordinator-errors";
import { createOpenAIItineraryAdapter } from "./itinerary-execution";
import { posthogAiObserver } from "./posthog-ai";
import { itineraryModelInput, ItineraryContextBudgetError } from "../itinerary-model-input";
import { itineraryEvidenceWindow, itineraryInstructions, type ItineraryInstruction } from "../itinerary-continuity";
import { researchForCoordinator } from "./coordinator-research";
import { tavilyLookupConfigured, tavilyResearchProvider } from "./coordinator-research-tavily";
import { buildPublicResearchQuery, sanitizeTypedResearchQuery } from "./coordinator-research-query";
import type { DispatchInput, DispatchResult } from "./coordinator-capabilities";
import { currentInferenceTrace } from "./inference-trace-context";
import { assembleCoordinatorSources } from "../coordinator-source-context";
import { perplexityResearchPlan } from "./perplexity-research-plan";
import { itineraryResearchPlan } from "./itinerary-research-plan";
import { isExplicitResearchRequest } from "./coordinator-routing";


function assessmentEvidence(assessment: ItineraryDraft["researchAssessment"]) {
  return assessment?.sources.map(({ runId, sourceId, title, url, excerpt, retrievedAt }) => ({ runId, sourceId, title, url, excerpt, retrievedAt })) ?? [];
}

function itineraryResearchClause(text: string) {
  // Current human text only; quoted/attached material and retained context are not authority to search.
  if (text.length > 2000 || /[`"“”]|(?:^|\n)\s*>/.test(text)) return undefined;
  const requests = text.split(/[.!;\n]\s*|\s+and\s+(?=(?:please\s+)?(?:research|look\s*up|search|check\s+online)\b)/i)
    .map(clause => clause.trim()).filter(isExplicitResearchRequest);
  return requests.length === 1 ? requests[0] : undefined;
}

export async function dispatchItinerary(input: DispatchInput): Promise<DispatchResult> {
  const turnStarted = performance.now();
  const action = input.explicitAction, environment = readCommonsRuntimeEnvironment();
  if (environment.COMMONS_ASSISTANT_UI_ENABLED !== "true" || action?.kind !== "itinerary" || !input.threadId) throw new CoordinatorTurnError("unsupported_capability");
  const publicRequest = action.publicQuery ?? (environment.COMMONS_DEEP_RESEARCH_PROVIDER === "perplexity" ? itineraryResearchClause(input.prompt) : undefined);
  if (publicRequest && (!coordinatorResearchEnabled(environment) || !await canUseCoordinatorSearch())) throw new CoordinatorTurnError("unsupported_capability");
  const importText = assembleCoordinatorSources(action.importText, input.attachedSources);
  const options = await authenticatedGoalOptions(input.slug);
  const saved = await itineraryContext(input.slug, input.threadId, options);
  const fetcher=publicRequest ? researchBetaFetch(saved.actorId,input.fetcher ?? fetch) : input.fetcher;
  if (action.documentId && saved.previous?.id !== action.documentId || (saved.previous?.version ?? 0) !== action.baseVersion) throw new CoordinatorTurnError("stale_version");
  if (input.currentTurnId && input.currentTurnAttempt) await associateItineraryInstruction(input.slug, {
    turnId: input.currentTurnId, commandId: input.commandId, attempt: input.currentTurnAttempt, threadId: input.threadId, baseVersion: action.baseVersion,
  }, options);
  // Itinerary synthesis stays on the approved direct OpenAI policy. Public research has its separate opt-in provider selector.
  const policy = coordinatorInferencePolicy(environment);
  if (!policy || policy.transport !== "openai") throw new CoordinatorProviderError("provider_not_configured");
  const model = policy.modelId(policy.models.planning);
  if (!model) throw new CoordinatorProviderError("provider_not_configured");
  const previous = saved.previous;
  if (previous?.workflow && action.workflowKey && action.workflowKey !== previous.workflow.key) throw new CoordinatorTurnError("stale_version");
  const workflow = await resolveWorkflowTemplate(previous?.workflow?.key ?? action.workflowKey ?? "itinerary", previous?.workflow, requireCommonsDatabaseUrl());
  if (workflow.purpose !== "itinerary") throw new CoordinatorTurnError("invalid_request");
  currentInferenceTrace()?.set({ workflowPurpose: workflow.purpose, workflowVersion: workflow.version, workflowDigest: workflowTemplateDigest(workflow) });
  const instructions: ItineraryInstruction[] = [], archived: ItineraryDraft["evidence"] = [];
  let before: number | undefined, historyComplete = false;
  // Storage is cursor-paged; execution is bounded independently. A larger archive
  // stays readable but needs a narrower workflow scope, not a silent old-history drop.
  for (let page = 0; page < 20; page++) {
    const result = await readItineraryHistoryPage(input.slug, input.threadId, previous?.id ?? null, options, before);
    for (const entry of result.entries) {
      if (entry.instruction !== null) instructions.push({ key: `request:${entry.turnId}`, text: entry.instruction, turnId: entry.turnId, actorId: entry.actorId, at: entry.at });
      archived.unshift(...entry.evidence);
    }
    if (result.nextBefore === null) { historyComplete = true; break; }
    before = result.nextBefore;
    input.signal?.throwIfAborted();
  }
  const currentInstructions = itineraryInstructions(previous, instructions.reverse(), { key: `request:${input.currentTurnId}`, text: input.prompt,
    turnId: input.currentTurnId ?? null, actorId: saved.actorId, at: new Date().toISOString() });
  const draft: ItineraryDraft = { id: previous?.id ?? randomUUID(), threadId: input.threadId, ownerId: previous?.ownerId ?? saved.actorId,
    workflow: pinnedWorkflowReference(workflow),
    version: (previous?.version ?? 0) + 1, facts: saved.facts, factsFingerprint: saved.factsFingerprint,
    imports: [...(previous?.imports ?? [])], corrections: currentInstructions.slice(-30).map(row => row.text),
    evidence: [], receipts: previous?.receipts ?? [],
    ...(previous?.researchAssessment ? { researchAssessment: previous.researchAssessment } : {}),
    content: previous?.content ?? { title: "Trip itinerary", brief: "", items: [], tasks: [], driverBrief: "", unresolved: [] } };
  const instruction = { draftId: previous?.id ?? null, baseVersion: action.baseVersion };
  if (importText) {
    const digest = createHash("sha256").update(importText).digest("hex");
    if (!draft.imports.some(item => item.digest === digest)) draft.imports.push({ id: randomUUID(), digest, text: importText, addedBy: saved.actorId, active: true });
  }
  draft.evidence = itineraryEvidenceWindow(draft.content, [...archived, ...assessmentEvidence(draft.researchAssessment)], previous?.evidence);
  const narrowScope = (): DispatchResult => {
    const answer = "This itinerary has more context than fits in one review. Your saved draft and research history are unchanged. You can edit the draft directly or remove unneeded selected notes before trying again.";
    return { capability: "research", modelTier: "none", assistantText: answer, spokenReply: answer, workspace: { tripConversation: true, itineraryInstruction: instruction }, data: null, attendanceStatement: false,
      topicTitle: null, threadSummary: null, openQuestions: null, sources: input.context.sources.slice(0, 20), model: null, providerMs: 0,
      detail: { retrievedThreads: 0, researchQueryChars: null, sourceCount: draft.evidence.length, navigation: null, unsupportedReason: "context_scope", researchMs: 0, modelMs: 0, validationMs: 0 } };
  };
  let research: CoordinatorResearch | undefined;
  const modelInput = () => itineraryModelInput(input.prompt, draft, { instructions: currentInstructions, historyComplete, researchExecution: research ? research.status === "unavailable" ? "unavailable" : "completed" : "not_requested", archivedSourceCount: new Set(archived.map(source => `${source.runId}:${source.sourceId}`)).size });
  try { modelInput(); } catch (error) { if (error instanceof ItineraryContextBudgetError) return narrowScope(); throw error; }
  let researchMs = 0;
  if (publicRequest) {
    const built = action.publicQuery ? null : buildPublicResearchQuery(publicRequest, input.context.snapshot);
    const query = action.publicQuery ? sanitizeTypedResearchQuery(action.publicQuery, input.context.snapshot) : built ? { query: built } : null;
    if (!query) throw new CoordinatorTurnError("invalid_request");
    input.onPhase?.("searching");
    // Only this separately reviewed, sanitized public query reaches the existing
    // search adapter. Never derive a search from raw imported commentary.
    const searchStarted = Date.now();
    if (environment.COMMONS_DEEP_RESEARCH_PROVIDER === "perplexity") {
      // Only the existing privacy-checked public query leaves Commons. Never send the saved draft, imports or raw prompt.
      // The explicit selection is fail-closed: no retry, native preset or hidden Tavily fallback.
      const shortlistItems = previous?.content.items.filter(item => item.decision?.shortlist?.length) ?? [];
      const missing = shortlistItems.length ? shortlistItems.flatMap(item => item.decision!.shortlist!.flatMap(option => optionCoverage(option, draft.evidence, decisionScopeFor(item)).filter(row => row.status !== "primary").map(row => row.requirement))) : undefined;
      const assessment = await perplexityResearchPlan(query.query, { apiKey: environment.PERPLEXITY_API_KEY,
        runId: input.currentTurnId!, searchQueries: itineraryResearchPlan(query.query, input.context.snapshot, missing, previous?.content.items.flatMap(item => item.decision?.shortlist?.map(option => option.label) ?? item.decision?.options ?? []) ?? []), signal: input.signal, fetcher });
      draft.researchAssessment = assessment;
      research = { query: query.query, status: "partial", sources: assessment.sources.slice(0, 5).map(source => ({
        id: source.sourceId, title: source.title, url: source.url, excerpt: source.excerpt, retrievedAt: source.retrievedAt,
        coverage: "snippet", sourceKind: "web", providerLabel: "Perplexity",
      })), limitations: [] };
    } else {
      research = tavilyLookupConfigured(environment) ? await (input.research ?? researchForCoordinator)(query.query, tavilyResearchProvider(environment.TAVILY_API_KEY, fetcher ?? fetch, environment.COMMONS_TAVILY_ACCESS_MODE), input.signal)
        : { query: query.query, sources: [], status: "unavailable", limitations: ["Web search is not connected. Suggestions are not verified."] };
      delete draft.researchAssessment;
    }
    researchMs = Date.now() - searchStarted;
    draft.evidence = itineraryEvidenceWindow(draft.content, [...archived, ...(draft.researchAssessment ? assessmentEvidence(draft.researchAssessment)
      : research.sources.map(source => ({ runId: input.currentTurnId!, sourceId: source.id, title: source.title, url: source.url, excerpt: source.excerpt, retrievedAt: source.retrievedAt })))], previous?.evidence);
  }
  ItineraryDraftSchema.parse(draft);
  const telemetry = input.request ? await posthogAiObserver(input.request, "workspace", `${input.slug}:${input.threadId}`, { capability: "research", inputMode: input.inputMode }) : undefined;
  const started = Date.now();
  // Leave 15s inside the route's 180s window for validation and durable commit after both providers.
  const remainingMs = Math.min(150_000, 165_000 - (performance.now() - turnStarted));
  if (remainingMs <= 0) throw new CoordinatorProviderError("provider_failed");
  const adapter = createOpenAIItineraryAdapter({ timeoutMs: remainingMs, apiKey: policy.apiKey, model, originalContent: previous?.content, workflow, observer: telemetry, fetcher });
  input.onPhase?.("preparing");
  let failed = false, modelMs = 0, validationMs = 0;
  try {
    const proposed = itineraryFeedbackContent(await adapter(modelInput(), input.signal), draft);
    const refined = previous ? scopeItineraryRefinement(previous.content, proposed, input.prompt) : proposed;
    const scoped = previous && research ? preserveResearchSchedule(previous.content, refined) : refined;
    // Human shortlists, notes, selections and choices survive model refinement.
    const content = {
      ...scoped,
      items: previous ? preserveShortlists(previous.content.items, scoped.items, draft.evidence) : scoped.items,
      // Resolution is human state, including on first construction. Model output cannot assert it.
      questions: scoped.questions?.map(question => {
        const old = previous?.content.questions?.find(row => row.id === question.id && row.prompt === question.prompt);
        return { id: question.id, prompt: question.prompt, ...(old?.resolved !== undefined ? { resolved: old.resolved } : {}) };
      }),
    };
    modelMs = Date.now() - started;
    const validationStarted = Date.now();
    draft.content = validateItineraryContent(content, draft, { privateDocumentEdit: true });
    draft.evidence = itineraryEvidenceWindow(content, draft.evidence);
    validationMs = Date.now() - validationStarted;
  }
  catch (error) { input.signal?.throwIfAborted(); if (!research) throw error; failed = true; }
  const unchanged = !failed && previous && itineraryContentEqual(previous.content, draft.content);
  const answer = unchanged ? "No document change was produced. The saved itinerary is unchanged; try a more specific edit or edit it in Work." : failed ? "The research is saved, but the itinerary could not be finished. Your previous draft is unchanged. Try again."
    : `Itinerary draft ${draft.version} is ready to review. ${!draft.evidence.length ? "No web evidence is attached; these are unverified suggestions. " : ""}Nothing has been added to the trip or booked.`;
  return { capability: "research", modelTier: "planning", assistantText: answer, spokenReply: answer,
    workspace: { tripConversation: true, itineraryInstruction: instruction, ...(research ? { research } : {}), ...(!failed ? { itineraryDraft: draft } : {}) }, data: null, attendanceStatement: false,
    topicTitle: previous ? null : "Research the itinerary", threadSummary: null, openQuestions: null, sources: input.context.sources.slice(0, 20), model, providerMs: Date.now() - started,
    detail: { retrievedThreads: 0, researchQueryChars: null, sourceCount: draft.evidence.length, navigation: null, unsupportedReason: null, researchMs, modelMs: failed ? Date.now() - started : modelMs, validationMs } };
}
