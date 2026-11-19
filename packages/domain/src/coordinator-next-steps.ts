import type { CommonsParticipant, CommonsState, CommonsSummary } from "@commons/contracts";

export type CoordinatorNextStep = {
  id: string;
  commonsId: string;
  personId: string;
  reason: "arrival_missing" | "arrival_time_missing" | "arrival_processing" | "arrival_review" | "arrival_intake_failed";
  evidence: Array<{ id: string; version: string }>;
  eligibility: "actionable" | "waiting" | "unavailable";
  capability: { manual: boolean; upload: boolean; review: boolean };
  completion: "usable_saved_arrival";
  intakeId?: string;
  sourceIds: string[];
  target: { kind: "travel"; planId: string | null; canEdit: boolean };
};

export type CoordinatorNextSteps = {
  travelThere: "unavailable" | "not_applicable" | "missing" | "incomplete" | "saved";
  steps: CoordinatorNextStep[];
};

/** Channel-neutral recommendations, never commands or permission grants.
 * Call only with the current person's server-filtered, event-scoped snapshot.
 * Upload drafts aren't durable snapshot state yet and must not be inferred.
 */
export function coordinatorNextSteps({ commons, state, participants, personId, now, travelState, intakes = [], intakeState = "loaded", uploadAvailable = false }: {
  commons: CommonsSummary;
  state: CommonsState;
  participants: readonly CommonsParticipant[];
  personId: string;
  now: number;
  travelState: "loaded" | "unavailable";
  intakeState?: "loaded" | "unavailable";
  uploadAvailable?: boolean;
  intakes?: Array<{ id: string; commonsId: string; ownerPersonId: string; kind: string; revision: number; status: string; draft?: { travelSegments?: Array<{ kind: string }> } | null }>;
}): CoordinatorNextSteps {
  const result = (travelThere: CoordinatorNextSteps["travelThere"], steps: CoordinatorNextStep[] = []): CoordinatorNextSteps => ({ travelThere, steps });
  if (travelState !== "loaded" || state.commonsId !== commons.id || !Number.isFinite(now) ||
    !participants.some(person => person.id === personId && person.membershipStatus === "active")) return result("unavailable");
  let today: string;
  try {
    today = new Intl.DateTimeFormat("en-CA", { timeZone: commons.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
  } catch { return result("unavailable"); }
  if (commons.status === "closing" || commons.status === "archived" || (commons.endsOn && commons.endsOn < today)) return result("not_applicable");

  const travel = state.travelPlans ?? [];
  const arrivals = travel.filter(plan => plan.kind === "arrival" && plan.status !== "considering" &&
    (plan.personIds ?? [plan.personId]).includes(personId));
  // A manually entered arrival is as useful as an imported booking. The uploader
  // isn't necessarily a traveler; only explicitly included people are covered.
  if (arrivals.some(plan => plan.time)) return result("saved");
  const incomplete = [...arrivals].sort((a, b) => Number(b.personId === personId) - Number(a.personId === personId) || a.id.localeCompare(b.id))[0];
  if (incomplete) return result("incomplete", [{
    id: `arrival_time_missing:${commons.id}:${personId}:${incomplete.id}`,
    commonsId: commons.id, personId, reason: "arrival_time_missing", sourceIds: [incomplete.id],
    target: { kind: "travel", planId: incomplete.id, canEdit: incomplete.personId === personId },
    evidence: [{id: incomplete.id, version: incomplete.version ?? `${incomplete.date}:${incomplete.time ?? ""}`}], eligibility: "actionable", capability: { manual: incomplete.personId === personId, upload: false, review: false }, completion: "usable_saved_arrival",
  }]);

  if (intakeState === "unavailable") return result("unavailable");
  const pending = intakes.find(row => row.commonsId === commons.id && row.ownerPersonId === personId && row.kind === "flight" && ["processing", "awaiting_review", "failed"].includes(row.status) && !(row.draft?.travelSegments?.length && row.draft.travelSegments.every(segment => segment.kind === "departure")));
  if (pending) return result("incomplete", [{ id: `arrival_intake:${pending.id}`, commonsId: commons.id, personId, reason: pending.status === "processing" ? "arrival_processing" : pending.status === "awaiting_review" ? "arrival_review" : "arrival_intake_failed", sourceIds: [pending.id], evidence: [{id:pending.id,version:String(pending.revision)}], intakeId:pending.id, eligibility:pending.status === "processing" ? "waiting" : "actionable", capability:{manual:true,upload:pending.status === "failed" && uploadAvailable,review:pending.status === "awaiting_review"}, completion:"usable_saved_arrival", target:{kind:"travel",planId:null,canEdit:true} }]);

  // A local or still-forming event must not acquire a universal flight task.
  const travelContext = Boolean(commons.lodging || state.stays?.some(stay => stay.status !== "considering") ||
    travel.some(plan => plan.kind !== "car_rental" && plan.status !== "considering"));
  if (!travelContext) return result("not_applicable");
  return result("missing", [{
    id: `arrival_missing:${commons.id}:${personId}`, commonsId: commons.id, personId,
    reason: "arrival_missing", sourceIds: [], evidence: [], eligibility: "actionable", capability: {manual: true, upload: uploadAvailable, review: false}, completion: "usable_saved_arrival", target: { kind: "travel", planId: null, canEdit: true },
  }]);
}

export function travelNextStepDescriptor(step: CoordinatorNextStep): import("@commons/contracts").NextStepDescriptor {
  return { id:step.id,scope:{tripId:step.commonsId,personId:step.personId,audience:"person"},reason:step.reason,evidence:step.evidence,eligibility:step.eligibility,target:{kind:"travel",id:step.intakeId ?? step.target.planId},capability:{action:step.reason === "arrival_processing" ? "await_processing" : step.reason === "arrival_review" ? "resume_review" : "enter_arrival",available:step.eligibility !== "unavailable",reason:step.target.canEdit ? null : "Only the owner can edit the shared arrival."},completion:step.completion };
}

/** Re-read authorized state before a delayed presenter delivers a recommendation. */
export function currentNextStep(previous: import("@commons/contracts").NextStepDescriptor, fresh: readonly import("@commons/contracts").NextStepDescriptor[]) {
  return fresh.find(step => step.id === previous.id && step.scope.tripId === previous.scope.tripId && step.scope.personId === previous.scope.personId && step.scope.audience === previous.scope.audience && step.eligibility !== "completed" && step.eligibility !== "unavailable" && JSON.stringify(step.evidence) === JSON.stringify(previous.evidence)) ?? null;
}
