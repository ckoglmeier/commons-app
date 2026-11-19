import { randomUUID } from "node:crypto";
import { or, and, desc, eq, inArray, sql } from "drizzle-orm";
import { BrainExecutionSchema, BrainDispositionRequestSchema, BrainSettingsRequestSchema, BrainSnapshotSchema, type BrainSnapshot } from "@commons/contracts";
import { brainLocalDay, brainPhase, brainSelectionCoverage, deterministicBrainReview, validateBrainFindings } from "@commons/domain";
import { createDatabase } from "./client";
import { commandFingerprint, CommandAccessError, CommandConflictError, runEventCommand, type CommandTransaction } from "./event-command";
import { requireTripOrganizer } from "./coordinator-turn-repository";
import { type GoalOptions } from "./coordinator-goal-repository";
import { commons, coordinatorGoals, itineraryItems, memberships, travelPlans, travelPlanParticipants, tripBrainSettings, tripBrainReviews, tripBrainRecommendations, tripTasks, auditEvents } from "./schema";
export type BrainOptions = GoalOptions & { enabled: boolean };
const hash = (input: unknown) => commandFingerprint("", "brain", input);
async function snapshotIn(tx: CommandTransaction, tripId: string, now: Date) {
  const [trip] = await tx.select().from(commons).where(eq(commons.id, tripId));
  const today = brainLocalDay(now, trip.timezone), phase = brainPhase(today, trip.startsOn, trip.endsOn);
  // Strict allowlist: no raw notes, names, contact details, costs, confirmations, private travel, transcripts, intake, or participant messages.
  const items = await tx.select().from(itineraryItems).where(and(eq(itineraryItems.commonsId, tripId), eq(itineraryItems.audience, "everyone"))).orderBy(itineraryItems.id).limit(100);
  const arrivals = await tx.select().from(travelPlans).where(and(eq(travelPlans.commonsId, tripId), eq(travelPlans.kind, "arrival"), or(inArray(travelPlans.kind, ["arrival", "departure"]), inArray(travelPlans.visibility, ["basic", "all"])))).orderBy(travelPlans.id).limit(100);
  const transportRows = await tx.select().from(travelPlans).where(and(eq(travelPlans.commonsId,tripId),eq(travelPlans.kind,"transport"),or(inArray(travelPlans.kind, ["arrival", "departure"]), inArray(travelPlans.visibility,["basic","all"])))).orderBy(travelPlans.id).limit(40);
  const tasks = await tx.select().from(coordinatorGoals).where(eq(coordinatorGoals.commonsId, tripId)).orderBy(coordinatorGoals.id).limit(40);
  const facts: BrainSnapshot["facts"] = [{ id: trip.id, kind: "event", version: trip.updatedAt.toISOString(), label: trip.name.slice(0,160), start: trip.startsOn, end: trip.endsOn, status: trip.status }];
  for (const item of items) {
    const seats=/\bcapacity:\s*(\d{1,2})\s*(?:passengers|people|seats)\b/i.exec(item.note??"");
    const capacity=seats&&Number(seats[1])>0?Number(seats[1]):null;
    const itemDay=item.startsAt?brainLocalDay(item.startsAt,trip.timezone):null,travelers=new Set<string>();
    if(capacity&&itemDay)for(const arrival of arrivals.filter(a=>a.date===itemDay&&a.status!=="considering")){const included=await tx.select().from(travelPlanParticipants).where(eq(travelPlanParticipants.travelPlanId,arrival.id));for(const id of included.length?included.map(p=>p.personId):[arrival.personId])travelers.add(id);}
    facts.push({id:item.id,kind:"plan",version:capacity?`${item.updatedAt.toISOString()}:${hash(arrivals.filter(a=>a.date===itemDay).map(a=>({id:a.id,version:a.updatedAt.toISOString(),status:a.status}))).slice(0,16)}:${travelers.size}`:item.updatedAt.toISOString(),label:item.title.slice(0,160),start:item.startsAt?.toISOString()??null,end:item.endsAt?.toISOString()??null,status:item.status,...(capacity?{capacity,groupPeople:travelers.size}:{})});
  }
  for (const arrival of arrivals) {
    const included = await tx.select().from(travelPlanParticipants).where(eq(travelPlanParticipants.travelPlanId, arrival.id));
    facts.push({ id: arrival.id, kind: "arrival", version: arrival.updatedAt.toISOString(), label: "Shared arrival", start: `${arrival.date}${arrival.time ? `T${arrival.time}` : ""}`, end: null, status: arrival.status, people: Math.max(1,included.length) });
  }
  for (const item of transportRows) facts.push({id:item.id,kind:"transport",version:item.updatedAt.toISOString(),label:item.route.slice(0,160),start:`${item.date}${item.time ? `T${item.time}` : ""}`,end:null,status:item.status});
  for (const task of tasks) facts.push({ id: task.id, kind: "task", version: `${task.revision}:${task.updatedAt.toISOString()}`, label: task.title.slice(0,160), start: null, end: null, status: task.lifecycle });
  for(const task of tasks)if(task.outcome?.kind === "research" && task.outcome.retrievedAt){const stale=now.getTime()-Date.parse(task.outcome.retrievedAt)>7*86400_000;const research=task.envelope.steps.find(step=>step.kind === "research");facts.push({id:`research:${task.id}`,kind:"research",version:`${task.outcomeRevision}:${task.outcome.retrievedAt}:${stale}`,label:task.title.slice(0,160),start:task.outcome.retrievedAt,end:null,status:stale?"stale":"fresh",publicQuery:research?.kind === "research"?research.query:undefined});}

  const boundedFacts = facts.slice(0,250);
  const snapshot = BrainSnapshotSchema.parse({ tripId, timezone: trip.timezone, phase, facts: boundedFacts, coverage: ["Shared itinerary, arrival and transport basics; organizer task statuses.", "Capacity is reviewed only when a shared plan explicitly records “Capacity: N seats/passengers/people”. Private arrivals, participant messages, confirmations and live inventory are excluded.", ...(facts.length > 250 || items.length === 100 || arrivals.length === 100 || transportRows.length === 40 || tasks.length === 40 ? ["Row limit reached; coverage is partial."] : [])], capturedAt: now.toISOString() });
  snapshot.coverage.push(...brainSelectionCoverage(snapshot));
  return { snapshot, snapshotHash: hash({ tripId, timezone: snapshot.timezone, phase, facts: boundedFacts, coverage: snapshot.coverage }), trip, materialChangedAt: new Date(Math.max(trip.updatedAt.getTime(), ...items.map(item=>item.updatedAt.getTime()), ...arrivals.map(arrival=>arrival.updatedAt.getTime()), ...transportRows.map(item=>item.updatedAt.getTime()), ...tasks.map(task=>task.updatedAt.getTime()))) };
}
/** Reviewed gaps become bounded reminders, never goals, Plan facts or dispatched work. */
async function ensureBrainTodo(tx: CommandTransaction, tripId: string, actorId: string, finding: import("@commons/contracts").BrainFinding, now: Date) {
  const todos = await tx.select().from(tripTasks).where(eq(tripTasks.commonsId,tripId));
  const existing = todos.find(todo => todo.brainFindingKey === finding.key || todo.title.toLowerCase() === finding.title.toLowerCase());
  if (existing) return existing.id; // Preserve completion and edits across evidence changes/reviews.
  const id = randomUUID();
  await tx.insert(tripTasks).values({id,commonsId:tripId,createdByPersonId:actorId,ownerPersonId:actorId,title:finding.title,brainFindingKey:finding.key,itemKind:null,itemId:null,createdAt:now,updatedAt:now});
  await tx.insert(auditEvents).values({commonsId:tripId,commandId:`brain-todo-${id}`,actorId,actorType:"commons",action:"trip_task.suggested",resourceType:"trip_task",resourceId:id,summary:`Commons added a to-do from saved evidence: ${finding.title}`,occurredAt:now});
  return id;
}
async function transaction<T>(options: BrainOptions, fn: (tx: CommandTransaction) => Promise<T>) { const db = createDatabase(options.databaseUrl); try { return await db.db.transaction(fn); } finally { await db.close(); } }
export async function brainState(identifier: string, options: BrainOptions) {
  return transaction(options, async tx => {
    const trip = await requireTripOrganizer(tx, identifier, options.actorPersonId), now = options.now ?? new Date();
    const current = await snapshotIn(tx, trip, now);
    const [settings] = await tx.select().from(tripBrainSettings).where(eq(tripBrainSettings.commonsId, trip));
    const reviews = await tx.select().from(tripBrainReviews).where(eq(tripBrainReviews.commonsId,trip)).orderBy(desc(tripBrainReviews.createdAt)).limit(1);
    const rows = await tx.select().from(tripBrainRecommendations).where(eq(tripBrainRecommendations.commonsId,trip)).orderBy(desc(tripBrainRecommendations.createdAt)).limit(30);
    const todos = await tx.select().from(tripTasks).where(eq(tripTasks.commonsId,trip));
    return { tripId:trip, settings: settings ? { optedIn: settings.optedIn, paused: settings.paused, entitled: settings.entitled, budgetConfigured: settings.budgetCents !== null } : { optedIn: false, paused: true, entitled: false, budgetConfigured: false }, lastReview: reviews[0] ? { at: reviews[0].createdAt.toISOString(), status: reviews[0].status, error: reviews[0].errorCode } : null, coverage: current.snapshot.coverage,
      recommendations: rows.filter(r => r.snapshotHash === current.snapshotHash && (r.disposition === "new" || r.disposition === "snoozed" && r.snoozedUntil && r.snoozedUntil <= now)).slice(0,3).map(r => ({ id: r.id, snapshotHash: r.snapshotHash, finding: r.finding, goalId: r.goalId, todoId: todos.find(todo => todo.brainFindingKey === r.findingKey || todo.title.toLowerCase() === r.finding.title.toLowerCase())?.id ?? null })).filter(r=>!r.todoId || !todos.find(todo=>todo.id===r.todoId)?.completed), snapshotHash: current.snapshotHash };
  });
}
export async function updateBrainSettings(identifier: string, raw: unknown, options: BrainOptions) {
  const input = BrainSettingsRequestSchema.parse(raw);
  return transaction(options, tx => runEventCommand(tx, { identifier, actorPersonId: options.actorPersonId, commandId: input.commandId, action: "brain.settings", input }, actor => { if (actor.role !== "organizer" || !options.enabled) throw new CommandAccessError(); }, async actor => {
    await tx.insert(tripBrainSettings).values({ commonsId: actor.id, optedIn: input.optedIn, paused: input.paused, optedByPersonId: options.actorPersonId }).onConflictDoUpdate({ target: tripBrainSettings.commonsId, set: { optedIn: input.optedIn, paused: input.paused, optedByPersonId: options.actorPersonId, updatedAt: actor.now } });
    return { result: { saved: true }, resourceType: "commons", resourceId: actor.id, summary: "Organizer changed advisory review opt-in." };
  }));
}
/** Qualification only; cannot be invoked against a remote database or through a product route. */
export async function configureLocalBrain(identifier: string, limits: { budgetCents: number; entitled: boolean }, options: BrainOptions) {
  if (!options.databaseUrl || !["127.0.0.1","localhost"].includes(new URL(options.databaseUrl).hostname) || !Number.isSafeInteger(limits.budgetCents) || limits.budgetCents < 0) throw new CommandAccessError();
  return transaction(options, async tx => { const trip = await requireTripOrganizer(tx, identifier, options.actorPersonId); await tx.insert(tripBrainSettings).values({ commonsId: trip, ...limits }).onConflictDoUpdate({ target: tripBrainSettings.commonsId, set: limits }); });
}
export async function beginBrainReview(identifier: string, reservation: { worstCaseCents: number; modelPolicy: "deterministic-v1" | "bounded-model-v1"; monthlyTripCents?: number; monthlyGlobalCents?: number }, options: BrainOptions) {
  return transaction(options, async tx => {
    const tripId = await requireTripOrganizer(tx, identifier, options.actorPersonId), now = options.now ?? new Date(), current = await snapshotIn(tx,tripId,now);
    const [settings] = await tx.select().from(tripBrainSettings).where(eq(tripBrainSettings.commonsId,tripId)).for("update");
    const denied = !options.enabled ? "disabled" : !settings?.optedIn ? "not_opted_in" : settings.paused ? "paused" : !settings.entitled ? "entitlement" : settings.budgetCents === null ? "budget_missing" : current.snapshot.phase === "ended" || ["closing","archived"].includes(current.trip.status) ? "trip_ended" : null;
    if (denied) return { dispatched: false as const, reason: denied };
    if (!settings || !Number.isSafeInteger(reservation.worstCaseCents) || reservation.worstCaseCents < 0 || reservation.modelPolicy === "bounded-model-v1" && reservation.worstCaseCents === 0 || reservation.modelPolicy === "deterministic-v1" && reservation.worstCaseCents !== 0) throw new CommandConflictError();
    // Serialize paid reservations across trips. Unset global/monthly limits forbid model dispatch.
    if (reservation.modelPolicy === "bounded-model-v1") {
      if (![reservation.monthlyTripCents, reservation.monthlyGlobalCents].every(cap=>Number.isSafeInteger(cap) && cap! > 0)) return {dispatched:false as const,reason:"model_limits_missing"};
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('commons-brain-monthly-budget'))`);
      const [totals]=await tx.execute<{trip:number;global:number}>(sql`select coalesce(sum(coalesce(actual_cents,reserved_cents)) filter (where commons_id=${tripId}),0)::int as trip, coalesce(sum(coalesce(actual_cents,reserved_cents)),0)::int as global from trip_brain_reviews where created_at >= date_trunc('month',${now.toISOString()}::timestamptz at time zone 'UTC') at time zone 'UTC' and model_policy='bounded-model-v1'`);
      if (totals.trip + reservation.worstCaseCents > reservation.monthlyTripCents! || totals.global + reservation.worstCaseCents > reservation.monthlyGlobalCents!) return {dispatched:false as const,reason:"monthly_budget_exhausted"};
    }
    // Expired work has unknown spend: consume its full reservation, never release optimistically.
    const history = await tx.select().from(tripBrainReviews).where(eq(tripBrainReviews.commonsId,tripId)).orderBy(desc(tripBrainReviews.createdAt));
    for (const old of history.filter(r => r.status === "running" && r.leaseUntil <= now)) {
      await tx.update(tripBrainReviews).set({ status: "failed", errorCode: "lease_expired_spend_unknown", actualCents: old.reservedCents, finishedAt: now }).where(eq(tripBrainReviews.id,old.id));
      settings.reservedCents -= old.reservedCents; settings.spentCents += old.reservedCents;
    }
    await tx.update(tripBrainSettings).set({ reservedCents: settings.reservedCents, spentCents: settings.spentCents }).where(eq(tripBrainSettings.commonsId,tripId));
    if (history.some(r => r.status === "running" && r.leaseUntil > now)) return { dispatched: false as const, reason: "running" };
    if (history.some(r => r.localDay === brainLocalDay(now,current.trip.timezone)) || history[0] && now.getTime() - history[0].createdAt.getTime() < 86400_000) return { dispatched: false as const, reason: "daily_cap" };
    if (history.some(r => r.status === "completed" && r.snapshotHash === current.snapshotHash)) return { dispatched: false as const, reason: "unchanged" };
    const materialDebounced=history[0] && history[0].snapshotHash !== current.snapshotHash && current.materialChangedAt > history[0].createdAt && now.getTime()-current.materialChangedAt.getTime() >= 30*60_000;
    if (settings.nextReviewAt && settings.nextReviewAt > now && !materialDebounced) return { dispatched: false as const, reason: "not_due" };
    if (settings.spentCents + settings.reservedCents + reservation.worstCaseCents > settings.budgetCents!) return { dispatched: false as const, reason: "budget_exhausted" };
    const [review] = await tx.insert(tripBrainReviews).values({ commonsId: tripId, requestedByPersonId: options.actorPersonId, snapshotHash: current.snapshotHash, snapshot: current.snapshot, localDay: brainLocalDay(now,current.trip.timezone), reservedCents: reservation.worstCaseCents, modelPolicy: reservation.modelPolicy, leaseUntil: new Date(now.getTime()+300_000), createdAt: now }).returning();
    await tx.update(tripBrainSettings).set({ reservedCents: settings.reservedCents+reservation.worstCaseCents, nextReviewAt: new Date(now.getTime()+(current.snapshot.phase === "planning" ? 7 : 1)*86400_000), updatedAt: now }).where(eq(tripBrainSettings.commonsId,tripId));
    return { dispatched: true as const, reviewId: review.id, snapshot: current.snapshot, snapshotHash: current.snapshotHash };
  });
}
export async function finishBrainReview(reviewId: string, raw: unknown, actualCents: number | null, options: BrainOptions, execution?: import("@commons/contracts").BrainExecution) {
  if(execution) BrainExecutionSchema.parse(execution);
  return transaction(options, async tx => {
    const [scope] = await tx.select().from(tripBrainReviews).where(eq(tripBrainReviews.id,reviewId)); if (!scope) throw new CommandAccessError();
    // A revoked organizer must not publish. Settlement still happens conservatively under the trip lock.
    await tx.select().from(commons).where(eq(commons.id,scope.commonsId)).for("update");
    const [review] = await tx.select().from(tripBrainReviews).where(eq(tripBrainReviews.id,reviewId)).for("update");
    if (review.requestedByPersonId !== options.actorPersonId) throw new CommandAccessError();
    if (review.status !== "running") return { published: false, reason: review.status };
    const now = options.now ?? new Date(), current = await snapshotIn(tx,review.commonsId,now);
    const [settings] = await tx.select().from(tripBrainSettings).where(eq(tripBrainSettings.commonsId,review.commonsId));
    const [actor] = await tx.select().from(memberships).where(and(eq(memberships.commonsId,review.commonsId),eq(memberships.personId,review.requestedByPersonId),eq(memberships.role,"organizer"),eq(memberships.status,"active")));
    let status: "completed" | "superseded" | "failed" = "completed", error: string | null = null;
    if (!actor || !settings?.entitled || !settings.optedIn || settings.paused || !options.enabled || current.snapshot.phase === "ended" || ["archived","closing"].includes(current.trip.status)) { status="superseded"; error="authority_changed"; }
    else if (review.snapshotHash !== current.snapshotHash) { status="superseded"; error="snapshot_changed"; }
    else if (review.leaseUntil <= now) { status="failed"; error="lease_expired"; }
    const spend = actualCents === null ? review.reservedCents : actualCents;
    if (!Number.isSafeInteger(spend) || spend < 0 || spend > review.reservedCents) throw new CommandConflictError();
    let findings: ReturnType<typeof validateBrainFindings> = [];
    if (status === "completed") try { findings=validateBrainFindings(review.snapshot,raw); } catch { status="failed"; error="invalid_evidence_or_output"; }
    if (status === "completed") for (const finding of findings) {
      const active = await tx.select().from(coordinatorGoals).where(and(eq(coordinatorGoals.commonsId,review.commonsId),inArray(coordinatorGoals.lifecycle,["ready","running","waiting_for_input","waiting_for_approval","waiting_for_event"])));
      const existing = active.find(goal => goal.goal === finding.goal || finding.evidence.some(ref => goal.ideaIds.includes(ref.id)));
      const [recommendation] = await tx.insert(tripBrainRecommendations).values({ commonsId:review.commonsId,reviewId:review.id,snapshotHash:review.snapshotHash,evidenceHash:hash(finding.evidence),findingKey:finding.key,finding,goalId:existing?.id ?? null,createdAt:now,updatedAt:now }).onConflictDoUpdate({target:[tripBrainRecommendations.commonsId,tripBrainRecommendations.findingKey,tripBrainRecommendations.evidenceHash],set:{snapshotHash:review.snapshotHash,reviewId:review.id,updatedAt:now}}).returning();
      if (!recommendation.goalId && recommendation.disposition !== "dismissed" && (recommendation.disposition !== "snoozed" || !recommendation.snoozedUntil || recommendation.snoozedUntil <= now)) await ensureBrainTodo(tx,review.commonsId,review.requestedByPersonId,finding,now);
    }
    await tx.update(tripBrainReviews).set({status,errorCode:error ?? execution?.error ?? null,actualCents:spend,finishedAt:now,...(execution?{execution}:{})}).where(eq(tripBrainReviews.id,review.id));
    if (settings) await tx.update(tripBrainSettings).set({reservedCents:settings.reservedCents-review.reservedCents,spentCents:settings.spentCents+spend,lastReviewAt:status === "completed" ? now : settings.lastReviewAt,updatedAt:now}).where(eq(tripBrainSettings.commonsId,review.commonsId));
    return { published:status === "completed", reason:error, findings:status === "completed" ? findings.length : 0 };
  });
}
export async function runDeterministicBrainReview(identifier: string, options: BrainOptions) {
  const start = await beginBrainReview(identifier,{worstCaseCents:0,modelPolicy:"deterministic-v1"},options);
  return start.dispatched ? finishBrainReview(start.reviewId,deterministicBrainReview(start.snapshot),0,options) : start;
}
export async function disposeBrainRecommendation(identifier: string, raw: unknown, options: BrainOptions) {
  const input=BrainDispositionRequestSchema.parse(raw);
  return transaction(options,tx => runEventCommand(tx,{identifier,actorPersonId:options.actorPersonId,commandId:input.commandId,action:"brain.disposition",input},actor => {if(actor.role !== "organizer" || !options.enabled)throw new CommandAccessError();},async actor => {
    const [r]=await tx.select().from(tripBrainRecommendations).where(and(eq(tripBrainRecommendations.id,input.recommendationId),eq(tripBrainRecommendations.commonsId,actor.id))).for("update");
    if(!r)throw new CommandAccessError();
    const current=await snapshotIn(tx,actor.id,options.now ?? actor.now);
    if(r.snapshotHash !== input.expectedSnapshot || r.snapshotHash !== current.snapshotHash)throw new CommandConflictError();
    if(r.disposition === "accepted" && r.goalId)return {result:{goalId:r.goalId as string | null,todoId:null as string | null},resourceType:"commons",resourceId:actor.id,summary:"Opened accepted recommendation."};
    if(r.disposition !== "new" && r.disposition !== "snoozed")throw new CommandConflictError();
    const goalId=r.goalId;
    const todoId = input.action === "accept" && !goalId ? await ensureBrainTodo(tx,actor.id,options.actorPersonId,r.finding,actor.now) : null;
    await tx.update(tripBrainRecommendations).set({disposition:input.action === "accept" ? "accepted" : input.action === "dismiss" ? "dismissed" : "snoozed",goalId,snoozedUntil:input.action === "snooze" ? new Date((options.now ?? actor.now).getTime()+7*86400_000) : null,updatedAt:actor.now}).where(eq(tripBrainRecommendations.id,r.id));
    return {result:{goalId,todoId},resourceType:"commons",resourceId:actor.id,summary:"Organizer reviewed an advisory reminder."};
  }));
}
