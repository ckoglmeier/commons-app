import { createHash } from "node:crypto";
import {
  DatesLocationConfigurationSchema, MAX_RECIPE_COMBINATIONS,
  ApproveRecipeOutcomeSchema, type DatesLocationBlock, type DatesLocationAlternative, type RecipeAdvice, type RecipeEvidenceBundle,
  type RecipeEvidenceSource, type RecipeOptionEvidence,
} from "@commons/contracts";
import { commandFingerprint } from "./event-command";
import type { z } from "zod";

type Dimension = RecipeOptionEvidence["dimension"];
type Question = RecipeEvidenceBundle["draft"]["questions"][number];
function semantics(question: Question): { dimension: Dimension; measure: "availability" | "interest" | "preference" } | null {
  if (question.kind === "text") return null;
  if (question.convergence) return question.convergence;
  // Old ballots have typed markers but no convergence metadata. Prompt wording is never parsed.
  if (question.kind === "choice" && question.options.some(option => option.alternative)) return { dimension: "combination", measure: question.selectionMode === "multiple" ? "availability" : "preference" };
  if (question.kind === "choice" && question.availability) return { dimension: "dates", measure: "availability" };
  return null;
}
function markerOf(option: Exclude<Question, { kind: "text" }>["options"][number]) {
  return option.alternative ? { ...option.alternative } : option.schedule ? { startsOn: option.schedule.startsOn, endsOn: option.schedule.endsOn } : option.place ? { place: option.place.name } : null;
}
function markerFingerprint(question: Exclude<Question, { kind: "text" }>, option: Exclude<Question, { kind: "text" }>["options"][number]) {
  return commandFingerprint("", "recipe_option_scope_v1", option.schedule ? { schedule: option.schedule, availability: "availability" in question && question.availability ? question.availability : { mode: "ranges", timezone: "UTC" } } : markerOf(option));
}
const keyOf = (dimension: Dimension, optionId: string) => `${dimension}:${optionId}`;
const sameMarker = (a: RecipeOptionEvidence["marker"], b: RecipeOptionEvidence["marker"]) => commandFingerprint("", "marker", a) === commandFingerprint("", "marker", b);
function stableId(seed: string) {
  const hex = createHash("sha256").update(seed).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Hashes identities, answers, audiences, trip state and the private draft, not merely lineage. */
export function recipeEvidenceFingerprint(bundle: Omit<RecipeEvidenceBundle, "fingerprint">) {
  return commandFingerprint("", "recipe_connected_evidence_v1", bundle);
}
export function assertRecipeAdviceFresh(bundle: RecipeEvidenceBundle, fingerprint: string, sourcePollIds: string[]) {
  if (fingerprint !== bundle.fingerprint) throw new Error("Advice is out of date. Review the latest answers, audience and draft before adopting it.");
  const expected = bundle.sources.map(source => source.pollId).sort();
  if (sourcePollIds.length !== expected.length || sourcePollIds.slice().sort().some((id, index) => id !== expected[index])) throw new Error("The evidence sources do not belong to this recommendation.");
}

export type ConnectedRecipeDecisionEvidence = {
  version: 1; runId: string; commonsId: string; connectedEvidenceFingerprint: string; guardFingerprint: string;
  selectedAlternative: DatesLocationAlternative;
  sources: RecipeEvidenceSource[]; currentAudience: RecipeEvidenceBundle["currentAudience"]; trip: RecipeEvidenceBundle["trip"];
  priorNeedResolutions: Array<{ pollId: string; responseId: string; questionId: string; resolution: string; text: string; personId: string | null; updatedAt: string }>;
};

/** Stable guard deliberately excludes approval receipts, draft versions and lifecycle flags. */
export function recipeApprovalGuard(bundle: RecipeEvidenceBundle, selectedAlternative: DatesLocationAlternative) {
  return commandFingerprint("", "recipe_outcome_guard_v1", { runId: bundle.runId, commonsId: bundle.commonsId,
    selectedAlternative, currentAudience: bundle.currentAudience, trip: bundle.trip,
    sources: bundle.sources.map(source => ({ pollId: source.pollId, revoked: source.status === "revoked", responseFingerprint: source.responseFingerprint, questions: source.questions, audience: source.audience,
      responses: source.responses, hiddenResponseCount: source.hiddenResponseCount })) });
}

/** Cross-round acknowledgments enter only the recipe command; a generic decision cannot supply this context. */
export function validateConnectedRecipeApproval(bundle: RecipeEvidenceBundle, input: z.infer<typeof ApproveRecipeOutcomeSchema>, selectedAlternative: DatesLocationAlternative): ConnectedRecipeDecisionEvidence {
  if (!bundle.complete) throw new Error("The complete round history must be reviewed before approving this result.");
  const current = bundle.sources.at(-1);
  if (current?.ballotMode === "secret") throw new Error("A secret ballot cannot establish attributed date-and-place feasibility. Prepare a transparent follow-up before approving.");
  const selectedMarker = { startsOn: selectedAlternative.startsOn, endsOn: selectedAlternative.endsOn, place: selectedAlternative.place };
  if (input.alternativeId !== selectedAlternative.id || current?.pollId !== input.pollId || current.status !== "closed" || current.superseded || !bundle.draft.published || !current.questions.some(question => question.kind === "choice" && question.selectionMode === "multiple" && question.options.some(option => option.id === selectedAlternative.id && option.alternative && sameMarker(option.alternative, selectedMarker))))
    throw new Error("Review a current, explicitly polled date-and-place option before approving.");
  const constraints = deriveRecipeAdvice(bundle).constraints.filter(need => need.source.pollId !== input.pollId);
  if ((bundle.sources.length > 1 || constraints.length || input.connectedEvidenceFingerprint) && input.connectedEvidenceFingerprint !== bundle.fingerprint) throw new Error("Connected answers, audience or constraints changed. Reload and review all rounds again.");
  const key = (item: { pollId: string; responseId: string; questionId: string }) => `${item.pollId}:${item.responseId}:${item.questionId}`;
  const priorNeedResolutions: ConnectedRecipeDecisionEvidence["priorNeedResolutions"] = [];
  const seen = new Set<string>();
  for (const resolution of input.priorNeedResolutions) {
    const identity = key(resolution);
    if (seen.has(identity)) throw new Error("Explain each earlier need once.");
    seen.add(identity);
    const need = constraints.find(need => need.source.responseId && key({ pollId: need.source.pollId, responseId: need.source.responseId, questionId: need.source.questionId }) === identity);
    const response = bundle.sources.find(source => source.pollId === resolution.pollId)?.responses.find(response => response.responseId === resolution.responseId);
    if (!need || !response || resolution.pollId === input.pollId) throw new Error("An earlier need reference is unknown, no longer applicable, or belongs to another run.");
    if (!resolution.resolution.trim()) throw new Error("Explain how each earlier need is handled for the selected option.");
    priorNeedResolutions.push({ ...resolution, text: need.text, personId: response.personId, updatedAt: response.updatedAt });
  }
  if (constraints.some(need => !need.source.responseId || !seen.has(key({ pollId: need.source.pollId, responseId: need.source.responseId, questionId: need.source.questionId })))) throw new Error("Explain how each earlier stated need is handled for the selected option before approving.");
  return { version: 1, runId: bundle.runId, commonsId: bundle.commonsId, connectedEvidenceFingerprint: bundle.fingerprint,
    guardFingerprint: recipeApprovalGuard(bundle, selectedAlternative), selectedAlternative, sources: bundle.sources,
    currentAudience: bundle.currentAudience, trip: bundle.trip, priorNeedResolutions };
}

/** Pure organizer-only projection. Each answer remains attached to its original immutable ballot. */
export function deriveRecipeAdvice(bundle: RecipeEvidenceBundle): RecipeAdvice {
  const audience = new Set(bundle.currentAudience.map(person => person.personId));
  const facts = new Map<string, RecipeOptionEvidence>();
  // Each dimension keeps its latest explicit inventory. A location-only follow-up does not erase settled date evidence.
  // A changed inventory within a dimension replaces that dimension, so removed options cannot reappear as recommendations.
  const inventories = new Map<Dimension, Question[]>();
  const retainInventories = (questions: Question[]) => {
    const grouped = new Map<Dimension, Question[]>();
    for (const question of questions) { const semantic = semantics(question); if (semantic) grouped.set(semantic.dimension, [...(grouped.get(semantic.dimension) ?? []), question]); }
    for (const [dimension, questions] of grouped) inventories.set(dimension, questions);
  };
  for (const source of bundle.sources) if (source.status !== "revoked") retainInventories(source.questions);
  retainInventories(bundle.draft.questions);
  for (const question of [...inventories.values()].flat()) {
    const semantic = semantics(question);
    if (!semantic || question.kind === "text") continue;
    for (const option of question.options) {
      const marker = markerOf(option);
      if (!marker || option.exclusive) continue;
      const key = keyOf(semantic.dimension, option.id);
      facts.set(key, { optionId: option.id, label: option.label, dimension: semantic.dimension, marker, markerFingerprint: markerFingerprint(question, option),
        yesPersonIds: [], maybePersonIds: [], noPersonIds: [], abstainedPersonIds: [], missingPersonIds: [...audience],
        unknownIdentityCount: 0, preferenceScore: 0, hasPreference: false, sources: [], worksForEveryoneAsked: false });
    }
  }
  const availability = new Map<string, Map<string, string>>(), preference = new Map<string, Map<string, number>>();
  const unverified = new Map<string, Set<string>>();
  const constraints: RecipeAdvice["constraints"] = [];
  const unknowns: string[] = [];
  for (const source of bundle.sources) {
    if (source.status === "revoked") continue;
    if (source.ballotMode === "secret") unknowns.push(`Round ${source.round}: secret ballot responses stay unattributed and cannot establish per-person availability, even after closing.`);
    if (!source.audience) unknowns.push(`Round ${source.round} used a public link; guest names cannot establish current participant coverage.`);
    else if (source.audience.guestEmails.length) unknowns.push(`Round ${source.round} included ${source.audience.guestEmails.length} email recipients without stable person identities.`);
    const sourceAudience = new Set(source.audience?.personIds ?? []);
    if (source.audience && (sourceAudience.size !== audience.size || [...audience].some(id => !sourceAudience.has(id)))) unknowns.push(`The audience changed since round ${source.round}; earlier coverage does not cover new participants.`);
    for (const response of source.responses) {
      for (const answer of response.answers) {
        if (answer.context?.kind === "need" && (!response.personId || audience.has(response.personId)) && !source.resolvedNeeds.some(need => need.responseId === response.responseId && need.questionId === answer.questionId && need.text === answer.context!.text)) {
          constraints.push({ name: response.name, text: answer.context.text, source: { pollId: source.pollId, questionId: answer.questionId, responseId: response.responseId } });
        }
      }
    }
    for (const question of source.questions) {
      const semantic = semantics(question);
      if (!semantic || question.kind === "text") continue;
      for (const option of question.options) {
        const fact = facts.get(keyOf(semantic.dimension, option.id)), marker = markerOf(option);
        if (!fact || !marker || !sameMarker(fact.marker, marker) || fact.markerFingerprint !== markerFingerprint(question, option)) continue;
        fact.sources.push({ pollId: source.pollId, questionId: question.id, optionId: option.id });
        const factKey = keyOf(fact.dimension, fact.optionId);
        for (const response of source.responses) {
          const answer = response.answers.find(answer => answer.questionId === question.id);
          if (!answer) continue;
          // Never join guests by their self-reported name, nor count a verified outsider as a current invitee.
          if (!response.personId || !audience.has(response.personId)) {
            const identities = unverified.get(factKey) ?? new Set<string>(); identities.add(`${source.pollId}:${response.responseId}`); unverified.set(factKey, identities); continue;
          }
          if (semantic.measure === "availability") {
            let value: string | undefined;
            if (question.kind === "option_response" && question.scale === "yes_maybe_no") value = answer.optionResponses?.find(row => row.optionId === option.id)?.value;
            if (question.kind === "choice" && answer.optionIds.length) value = answer.optionIds.includes(option.id) ? "yes" : question.options.some(row => row.exclusive && answer.optionIds.includes(row.id)) ? "no" : "maybe";
            if (answer.abstained) value = "abstain";
            if (value) { const byPerson = availability.get(factKey) ?? new Map<string, string>(); byPerson.set(response.personId, value); availability.set(factKey, byPerson); }
          } else {
            let score: number | undefined;
            if (question.kind === "option_response" && question.scale === "interest") {
              const value = answer.optionResponses?.find(row => row.optionId === option.id)?.value;
              score = value === "top_choice" ? 3 : value === "interested" ? 2 : value === "could_go" ? 1 : value === "not_interested" || value === "abstain" ? 0 : undefined;
            } else if (question.kind === "allocation") score = answer.allocations?.find(row => row.optionId === option.id)?.points;
            else if (question.kind === "ranking" && answer.rankedOptionIds?.includes(option.id)) score = question.options.length - answer.rankedOptionIds.indexOf(option.id);
            else if (question.kind === "choice" && answer.optionIds.length) score = answer.optionIds.includes(option.id) ? 1 : 0;
            if (answer.abstained) score = 0;
            if (score !== undefined) { const byPerson = preference.get(factKey) ?? new Map<string, number>(); byPerson.set(response.personId, score); preference.set(factKey, byPerson); }
          }
        }
      }
    }
  }
  for (const [key, fact] of facts) {
    const values = availability.get(key) ?? new Map<string, string>();
    fact.yesPersonIds = [...values].filter(([, value]) => value === "yes").map(([id]) => id);
    fact.maybePersonIds = [...values].filter(([, value]) => value === "maybe").map(([id]) => id);
    fact.noPersonIds = [...values].filter(([, value]) => value === "no").map(([id]) => id);
    fact.abstainedPersonIds = [...values].filter(([, value]) => value === "abstain").map(([id]) => id);
    fact.missingPersonIds = [...audience].filter(id => !values.has(id));
    fact.unknownIdentityCount = unverified.get(key)?.size ?? 0;
    const scores = preference.get(key); fact.hasPreference = Boolean(scores?.size); fact.preferenceScore = [...(scores?.values() ?? [])].reduce((sum, n) => sum + n, 0);
    fact.worksForEveryoneAsked = fact.dimension === "combination" && audience.size > 0 && fact.yesPersonIds.length === audience.size && !constraints.length && (!bundle.reviewedAlternativeId || bundle.reviewedAlternativeId === fact.optionId);
  }
  const rows = [...facts.values()];
  const advice: RecipeAdvice = { version: 1, method: "rules", evidenceFingerprint: bundle.fingerprint, action: "supply_options",
    title: "Add the next options to compare", reason: "There is not yet enough explicit availability evidence to select a date and place.",
    stoppingCondition: "Review an explicitly polled combination with current participant coverage and resolve applicable needs before human approval.",
    facts: rows, constraints, unknowns: [...new Set(unknowns)], sourceFingerprints: bundle.sources.map(source => ({ pollId: source.pollId, fingerprint: source.fingerprint })),
    proposedConfiguration: null, estimatedDecisionsPerRespondent: 0, estimatedTotalDecisions: 0, suggestedAlternativeId: null };
  const recommend = (action: RecipeAdvice["action"], title: string, reason: string) => Object.assign(advice, constraints.length ? { action: "resolve_constraints" as const, title: "Resolve the stated needs first", reason: "Participant needs remain unresolved. Review them for the chosen option; useful feasibility questions can still be prepared conditionally." } : { action, title, reason });
  if (!bundle.complete) { advice.unknowns.push("The run exceeds the twenty-round evidence review bound. Review its history directly before a new recommendation."); return advice; }
  if (!audience.size) { advice.unknowns.push("No intended participants with stable identities are available."); return advice; }
  const current = bundle.sources.at(-1);
  if (current?.status === "open" && bundle.draft.published) return recommend("collect_existing", "Finish the current ask", "Voting is still open. Collect or review its remaining answers before creating another round.");
  const workable = rows.filter(row => row.worksForEveryoneAsked && bundle.draft.published && current?.status === "closed" && current.ballotMode === "transparent" && !current.superseded && current.questions.some(question => question.kind === "choice" && question.selectionMode === "multiple" && question.options.some(option => option.id === row.optionId && option.alternative && sameMarker(option.alternative, row.marker)))).sort((a, b) => b.preferenceScore - a.preferenceScore);
  if (workable.length) {
    advice.suggestedAlternativeId = workable[0].optionId;
    if (current?.approvedOutcome && current.approvedOutcome.status !== "superseded") return recommend("review_outcome", "The fit is recorded", "The organizer approved this combination using the reviewed evidence and need explanations. No further ask is required while those inputs remain current.");
    return recommend("review_outcome", "Review the fit and decide", `${workable.length === 1 ? "One explicitly polled combination works" : "Explicitly polled combinations work"} for every current participant. Further preference questions are optional; the organizer can review and approve an outcome now.`);
  }
  const combinations = rows.filter(row => row.dimension === "combination");
  const prepare = (block: DatesLocationBlock, reason: string) => {
    advice.proposedConfiguration = DatesLocationConfigurationSchema.parse({ version: 2, blocks: [block] });
    advice.estimatedDecisionsPerRespondent = block.options.length;
    advice.estimatedTotalDecisions = block.options.length * audience.size;
    return recommend("prepare_questions", block.type === "combination" ? "Check the shortlisted combinations" : "Check date availability", reason);
  };
  if (current?.ballotMode === "secret" && combinations.length >= 2 && combinations.length <= MAX_RECIPE_COMBINATIONS) return prepare({ id: stableId(`${bundle.runId}:advice:transparent-combination`), type: "combination", prompt: "Which date-and-place options could you do? Select every option that works.", required: true, options: combinations.map(row => ({ id: row.optionId, ...row.marker })) }, "The secret ballot gives aggregate feedback only. A transparent follow-up can establish current participant availability; its responses will be new votes.");
  if (combinations.length && combinations.some(row => !row.noPersonIds.length)) return recommend("collect_existing", "Clarify the remaining combination feedback", "Missing replies, abstentions or conditional answers prevent a universal fit. Follow up on the existing options or explicitly review exceptions; earlier answers are not new votes.");
  const dates = rows.filter(row => row.dimension === "dates" && !row.noPersonIds.length);
  const locations = rows.filter(row => row.dimension === "location" && !row.noPersonIds.length);
  const dateOptions = dates.map(row => ({ id: row.optionId, ...row.marker }));
  const fullyCoveredDates = dates.filter(row => row.yesPersonIds.length === audience.size);
  if (!fullyCoveredDates.length && dates.length >= 2) return prepare({ id: stableId(`${bundle.runId}:advice:dates`), type: "dates", prompt: "Which date ranges work for you?", required: true, options: dateOptions }, "Date feasibility is still unknown. Ask availability before using destination enthusiasm or relative preferences.");
  if (dates.length && locations.length) {
    if (!fullyCoveredDates.length) { advice.unknowns.push("Date availability remains conditional or missing; add another date option or resolve the existing availability first."); return advice; }
    const options = fullyCoveredDates.flatMap(date => locations.map(location => {
      const marker = { ...date.marker, ...location.marker };
      return { id: stableId(`${bundle.runId}:combination:${JSON.stringify(marker)}`), ...marker };
    })).filter(option => !combinations.some(row => row.noPersonIds.length && sameMarker(row.marker, option)));
    if (options.length >= 2 && options.length <= MAX_RECIPE_COMBINATIONS) return prepare({ id: stableId(`${bundle.runId}:advice:combination`), type: "combination", prompt: "Which date-and-place options could you do? Select every option that works.", required: true, options }, "Dates and places were considered independently. Explicit combination availability checks their dependency; interest, rankings and points provide no inherited combination support.");
    advice.unknowns.push(options.length > MAX_RECIPE_COMBINATIONS ? "The independent shortlist produces more than ten combinations. Narrow it explicitly before asking." : "Only one untested combination remains. The current builder needs at least two real options; review or add another option explicitly.");
  }
  if (combinations.length && combinations.every(row => row.noPersonIds.length)) advice.reason = "Every current combination has explicit unavailability. Change the options or resolve the constraints before a preference tie-break.";
  for (const row of rows.filter(row => !row.sources.length)) advice.unknowns.push(`${row.label}: this new or changed option has no matching prior support.`);
  return constraints.length ? recommend("resolve_constraints", "Resolve the stated needs first", "Participant needs remain unresolved.") : advice;
}

/** Server projection helper: secret ballots stay hidden while open, even for advice. */
export function visibleRecipeEvidenceSource(source: RecipeEvidenceSource): RecipeEvidenceSource {
  return source.ballotMode === "secret" ? { ...source, hiddenResponseCount: source.responses.length, responses: [], resolvedNeeds: [] } : source;
}
