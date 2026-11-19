import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { ApproveRecipeOutcomeSchema, buildDatesLocationPollData, type PollAnswer, type PollQuestion, type RecipeEvidenceBundle, type RecipeEvidenceSource } from "@commons/contracts";
import { assertRecipeAdviceFresh, deriveRecipeAdvice, recipeApprovalGuard, recipeEvidenceFingerprint, validateConnectedRecipeApproval, visibleRecipeEvidenceSource } from "./recipe-advice";

const ids = { run: randomUUID(), trip: randomUUID(), draft: randomUUID(), ana: randomUUID(), ben: randomUUID() };
const dates = [{ id: randomUUID(), startsOn: "2026-11-10", endsOn: "2026-11-13" }, { id: randomUUID(), startsOn: "2026-11-17", endsOn: "2026-11-20" }];
const places = [{ id: randomUUID(), place: "Portland" }, { id: randomUUID(), place: "Denver" }];
const combination = [{ ...dates[0], id: randomUUID(), place: "Portland" }, { ...dates[1], id: randomUUID(), place: "Denver" }];
function questions(type: "dates" | "location" | "combination" | "allocation", options = type === "dates" ? dates : type === "location" ? places : combination): PollQuestion[] {
  return buildDatesLocationPollData({ configuration: { version: 2, blocks: [{ id: randomUUID(), type, ...(type === "allocation" ? { dimension: "combination" as const } : {}), prompt: "Which options?", required: true, options }] } }).questions as PollQuestion[];
}
function answer(question: PollQuestion, values: string[]): PollAnswer {
  if (question.kind === "option_response") return { questionId: question.id, optionIds: [], text: null, optionResponses: question.options.map((option, index) => ({ optionId: option.id, value: values[index] as "yes" })) };
  return { questionId: question.id, optionIds: values, text: null };
}
function source(qs: PollQuestion[], people = [ids.ana, ids.ben], values = ["yes", "yes"]): RecipeEvidenceSource {
  return { pollId: randomUUID(), round: 1, fingerprint: "a".repeat(64), status: "closed", ballotMode: "transparent", audience: { personIds: [ids.ana, ids.ben], guestEmails: [] }, superseded: false, questions: qs,
    responses: people.map((personId, index) => ({ responseId: randomUUID(), personId, name: index ? "Ben" : "Ana", updatedAt: "2026-10-11T12:00:00.000Z", answers: qs.map(q => answer(q, q.kind === "choice" ? q.options.filter(o => !o.exclusive).map(o => o.id) : values)) })),
    hiddenResponseCount: 0, resolvedNeeds: [], approvedOutcome: null };
}
function bundle(sources: RecipeEvidenceSource[], draftQuestions = sources.at(-1)?.questions ?? [], published = true): RecipeEvidenceBundle {
  const evidence = { runId: ids.run, commonsId: ids.trip, complete: true,
    currentAudience: [{ personId: ids.ana, name: "Ana", status: "active" as const }, { personId: ids.ben, name: "Ben", status: "invited" as const }],
    trip: { startsOn: null, endsOn: null, locationNames: [] }, draft: { id: ids.draft, version: 1, published, questions: draftQuestions }, sources };
  return { ...evidence, fingerprint: recipeEvidenceFingerprint(evidence) };
}
function fingerprint(input: RecipeEvidenceBundle) { const { fingerprint: _unused, ...rest } = input; return { ...input, fingerprint: recipeEvidenceFingerprint(rest) }; }

test("explicit current combination evidence can stop without a redundant round; read-only", () => {
  const evidence = bundle([source(questions("combination"))]), before = JSON.stringify(evidence);
  const advice = deriveRecipeAdvice(evidence);
  assert.equal(advice.action, "review_outcome"); assert.equal(advice.proposedConfiguration, null); assert.equal(advice.estimatedTotalDecisions, 0);
  assert.ok(advice.facts.every(fact => fact.worksForEveryoneAsked)); assert.equal(JSON.stringify(evidence), before);
});
test("missing invitees, audience turnover, and abstention prevent universal fit", () => {
  const qs = questions("combination"), one = bundle([source(qs, [ids.ana])]);
  assert.equal(deriveRecipeAdvice(one).action, "collect_existing"); assert.ok(deriveRecipeAdvice(one).facts.every(fact => fact.missingPersonIds.includes(ids.ben)));
  const changed = bundle([source(qs)]); changed.currentAudience.push({ personId: randomUUID(), name: "New invitee", status: "invited" });
  assert.ok(deriveRecipeAdvice(changed).unknowns.some(text => text.includes("audience changed"))); assert.equal(deriveRecipeAdvice(changed).action, "collect_existing");
  const availability = questions("dates"), abstained = source(availability, [ids.ana, ids.ben], ["yes", "abstain"]);
  assert.ok(deriveRecipeAdvice(bundle([abstained])).facts.some(fact => fact.abstainedPersonIds.length === 2));
});
test("public guest names are response-local; matching names cannot cover current invitees", () => {
  const s = source(questions("combination")); s.audience = null;
  s.responses = s.responses.map(response => ({ ...response, personId: null, name: "Ana" }));
  const advice = deriveRecipeAdvice(bundle([s]));
  assert.equal(advice.action, "collect_existing"); assert.ok(advice.facts.every(fact => fact.yesPersonIds.length === 0 && fact.unknownIdentityCount === 2));
  assert.ok(advice.unknowns.some(text => text.includes("public link")));
});
test("interest and zero points never establish availability or an unavailable veto", () => {
  const interest = source(questions("location"), [ids.ana, ids.ben], ["top_choice", "not_interested"]);
  const interestAdvice = deriveRecipeAdvice(bundle([interest]));
  assert.ok(interestAdvice.facts.every(fact => fact.yesPersonIds.length === 0 && fact.noPersonIds.length === 0));
  const qs = questions("allocation"), points = source(qs);
  points.responses.forEach(response => response.answers = [{ questionId: qs[0].id, optionIds: [], text: null, allocations: combination.map((option, index) => ({ optionId: option.id, points: index ? 10 : 0 })) }]);
  assert.ok(deriveRecipeAdvice(bundle([points])).facts.every(fact => fact.noPersonIds.length === 0 && !fact.worksForEveryoneAsked));
});
test("new identities and changed date markers receive no inherited support", () => {
  const qs = questions("combination"), s = source(qs), newQuestions = structuredClone(qs);
  if (newQuestions[0].kind !== "choice") throw new Error("fixture");
  newQuestions[0].options[0].id = randomUUID(); newQuestions[0].options[1].alternative!.startsOn = "2026-11-18";
  const advice = deriveRecipeAdvice(bundle([s], newQuestions, false));
  assert.ok(advice.facts.every(fact => !fact.sources.length && fact.yesPersonIds.length === 0));
});
test("unresolved earlier-round needs dominate preferences and later combination coverage", () => {
  const first = source(questions("location"), [ids.ana, ids.ben], ["top_choice", "interested"]);
  first.responses[0].answers[0].context = { kind: "need", text: "At least four days" };
  const last = source(questions("combination")); last.round = 2;
  const evidence = bundle([first, last]);
  assert.equal(deriveRecipeAdvice(evidence).action, "resolve_constraints"); assert.ok(deriveRecipeAdvice(evidence).facts.every(fact => !fact.worksForEveryoneAsked));
  assert.equal(deriveRecipeAdvice(evidence).constraints[0].source.pollId, first.pollId);
  first.resolvedNeeds = [{ responseId: first.responses[0].responseId, questionId: first.questions[0].id, text: "At least four days" }];
  assert.equal(deriveRecipeAdvice(bundle([first, last])).action, "review_outcome");
  first.responses[0].answers[0].context.text = "At least five days";
  assert.equal(deriveRecipeAdvice(bundle([first, last])).action, "resolve_constraints", "a revised need invalidates the old resolution");
});
test("independent dates and location interest produce explicit combinations, never fabricated joint votes", () => {
  const dateSource = source(questions("dates")), locationSource = source(questions("location"), [ids.ana, ids.ben], ["interested", "top_choice"]); locationSource.round = 2;
  const advice = deriveRecipeAdvice(bundle([dateSource, locationSource], locationSource.questions, false));
  assert.equal(advice.action, "prepare_questions"); assert.equal(advice.proposedConfiguration?.blocks[0].type, "combination");
  assert.equal(advice.proposedConfiguration?.blocks[0].options.length, 4); assert.equal(advice.estimatedTotalDecisions, 8);
  assert.equal(advice.facts.filter(fact => fact.dimension === "dates").length, 2, "location follow-up retains resolved date evidence");
  assert.ok(advice.facts.every(fact => !fact.worksForEveryoneAsked));
});
test("a fully covered date avoids repeating availability; combination fit comes before a preference tie-break", () => {
  const dateSource = source(questions("dates"), [ids.ana, ids.ben], ["maybe", "yes"]), locationSource = source(questions("location"), [ids.ana, ids.ben], ["top_choice", "interested"]);
  const next = deriveRecipeAdvice(bundle([dateSource, locationSource], locationSource.questions, false)).proposedConfiguration!.blocks[0];
  assert.equal(next.type, "combination"); assert.ok(next.options.every(option => option.startsOn === dates[1].startsOn), "the uncertain date is not a mandatory blocker when another date is already covered");
  const combo = source(questions("combination"));
  combo.responses[1].answers[0].optionIds = [(combo.questions[0] as Exclude<PollQuestion, { kind: "text" }>).options[1].id];
  const advice = deriveRecipeAdvice(bundle([combo]));
  assert.equal(advice.suggestedAlternativeId, combination[1].id, "legacy nonselection is conditional, not certified yes");
});
test("evidence changes, audience changes and foreign sources reject pending adoption", () => {
  const original = bundle([source(questions("dates"))]);
  assert.doesNotThrow(() => assertRecipeAdviceFresh(original, original.fingerprint, original.sources.map(s => s.pollId)));
  const changed = structuredClone(original); changed.sources[0].responses[0].answers[0].context = { kind: "need", text: "Changed constraint" };
  assert.throws(() => assertRecipeAdviceFresh(fingerprint(changed), original.fingerprint, original.sources.map(s => s.pollId)), /out of date/);
  const audience = structuredClone(original); audience.currentAudience.pop();
  assert.throws(() => assertRecipeAdviceFresh(fingerprint(audience), original.fingerprint, original.sources.map(s => s.pollId)), /out of date/);
  assert.throws(() => assertRecipeAdviceFresh(original, original.fingerprint, [randomUUID()]), /sources/);
});
test("secret ballots remain unattributed after close; incomplete history cannot make recommendations", () => {
  const secret = source(questions("combination")); secret.ballotMode = "secret"; secret.status = "open";
  const visible = visibleRecipeEvidenceSource(secret);
  assert.equal(visible.responses.length, 0); assert.equal(visible.hiddenResponseCount, 2);
  assert.ok(deriveRecipeAdvice(bundle([visible])).facts.every(fact => !fact.worksForEveryoneAsked));
  secret.status = "closed"; const closed = visibleRecipeEvidenceSource(secret); assert.equal(closed.responses.length, 0); assert.equal(closed.resolvedNeeds.length, 0);
  const next = deriveRecipeAdvice(bundle([closed])); assert.equal(next.action, "prepare_questions"); assert.match(next.reason, /transparent follow-up/); assert.ok(next.unknowns.every(text => !text.includes("until")));
  const tooLong = bundle([source(questions("dates"))]); tooLong.complete = false;
  assert.equal(deriveRecipeAdvice(tooLong).proposedConfiguration, null);
});
test("prior need approval is source-bound and candidate-bound; missing, duplicate, foreign and stale references fail", () => {
  const first = source(questions("location"), [ids.ana, ids.ben], ["interested", "top_choice"]);
  first.responses[0].answers[0].context = { kind: "need", text: "Own bed" };
  const final = source(questions("combination")); final.round = 2;
  const evidence = bundle([first, final]), need = { pollId: first.pollId, responseId: first.responses[0].responseId, questionId: first.questions[0].id, resolution: "Private room selected for this option" };
  const approval = ApproveRecipeOutcomeSchema.parse({ commandId: randomUUID(), pollId: final.pollId, evidenceFingerprint: final.fingerprint,
    connectedEvidenceFingerprint: evidence.fingerprint, alternativeId: combination[0].id, priorNeedResolutions: [need], uncertaintyAcknowledged: true });
  const snapshot = validateConnectedRecipeApproval(evidence, approval, combination[0]);
  assert.equal(snapshot.priorNeedResolutions[0].text, "Own bed"); assert.equal(snapshot.priorNeedResolutions[0].personId, ids.ana);
  assert.throws(() => validateConnectedRecipeApproval(evidence, { ...approval, priorNeedResolutions: [] }, combination[0]), /each earlier stated need/);
  assert.throws(() => validateConnectedRecipeApproval(evidence, { ...approval, priorNeedResolutions: [need, need] }, combination[0]), /once/);
  assert.throws(() => validateConnectedRecipeApproval(evidence, { ...approval, priorNeedResolutions: [{ ...need, pollId: randomUUID() }] }, combination[0]), /unknown/);
  assert.throws(() => validateConnectedRecipeApproval(evidence, { ...approval, connectedEvidenceFingerprint: "0".repeat(64) }, combination[0]), /changed/);
  assert.notEqual(snapshot.guardFingerprint, recipeApprovalGuard(evidence, combination[1]), "another chosen option needs another review");
  const changed = structuredClone(evidence); changed.sources[0].responses[0].answers[0].context!.text = "Separate room";
  assert.notEqual(snapshot.guardFingerprint, recipeApprovalGuard(changed, combination[0]));
  const audience = structuredClone(evidence); audience.currentAudience.pop(); assert.notEqual(snapshot.guardFingerprint, recipeApprovalGuard(audience, combination[0]));
  const lifecycle = structuredClone(evidence); lifecycle.sources[1].approvedOutcome = { id: randomUUID(), status: "approved", alternativeId: combination[0].id }; lifecycle.draft.version++;
  assert.equal(snapshot.guardFingerprint, recipeApprovalGuard(lifecycle, combination[0]), "approval itself and private draft version do not make the stable apply guard stale");
  lifecycle.sources[0].status = "revoked"; assert.notEqual(snapshot.guardFingerprint, recipeApprovalGuard(lifecycle, combination[0]), "revoked evidence is no longer eligible");
});
test("an unresolved need permits a conditional next ask without becoming approval-ready", () => {
  const d = source(questions("dates")), l = source(questions("location"), [ids.ana, ids.ben], ["interested", "top_choice"]);
  l.responses[0].answers[0].context = { kind: "need", text: "Own bed" };
  const advice = deriveRecipeAdvice(bundle([d, l], l.questions, false));
  assert.equal(advice.action, "resolve_constraints"); assert.equal(advice.proposedConfiguration?.blocks[0].type, "combination");
  assert.ok(advice.facts.every(fact => !fact.worksForEveryoneAsked));
});
test("ranking-only follow-up cannot use earlier combination votes to claim current approval is ready", () => {
  const prior = source(questions("combination")); prior.superseded = true;
  const currentQuestions = buildDatesLocationPollData({ configuration: { version: 2, blocks: [{ id: randomUUID(), type: "ranking", dimension: "combination", prompt: "Rank the options", required: false, options: combination }] } }).questions as PollQuestion[];
  const current = source(currentQuestions); current.round = 2;
  for (const response of current.responses) response.answers = [{ questionId: currentQuestions[0].id, optionIds: [], text: null, rankedOptionIds: combination.map(option => option.id) }];
  assert.notEqual(deriveRecipeAdvice(bundle([prior, current])).action, "review_outcome");
});
test("current secret combination cannot use prior named availability to claim approval is ready", () => {
  const qs = questions("combination"), prior = source(qs); prior.superseded = true;
  const current = source(qs); current.round = 2; current.ballotMode = "secret";
  const advice = deriveRecipeAdvice(bundle([prior, visibleRecipeEvidenceSource(current)]));
  assert.equal(advice.action, "prepare_questions");
  assert.equal(advice.proposedConfiguration?.blocks[0].type, "combination");
  assert.match(advice.reason, /transparent follow-up/);
});
