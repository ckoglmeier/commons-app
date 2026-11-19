import {
    claimDueOutbound, closeQuestion, expireQuestions, getQuestion, membershipAttendance, personAuth, phoneNumberFor, recentProactive, recordSendResult, sendEligibility, tripIdForPoll, tripInfo, unprocessedInbound, type MessageRow,
} from "@commons/database";
import { cadenceDecision, DEFAULT_CADENCE, isQuietHours, quietHoursEnd } from "@commons/domain";
import { dbOptions, messagingDeps, type MessagingDeps } from "./core";
import { processInbound } from "./inbound";
import { openBalances, planQuestions, planQuestionsForTrip, pollNoticeStillNeeded, questionState } from "./planner";
import { ProviderSendError, sendGate, unconfiguredProvider } from "./provider";
import { carrierFor, webCarrier } from "./web-carrier";

const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [60_000, 5 * 60_000, 20 * 60_000, 60 * 60_000];
const baseKey = (key: string | null) => (key ?? "").replace(/:\d+$/, "");
const warn = (name: string, detail: Record<string, unknown>) => console.warn(name, detail);

export type DispatchSummary = { sent: number; deferred: number; suppressed: number; failed: number; retried: number; blocked: string | null };

/**
 * Send what is due. Each message is rechecked immediately before it leaves: a number that changed, a membership that ended, a withdrawn consent, an
 * opt-out, a task that was resolved in the meantime, quiet hours and cadence. Retryable provider errors back off; an unknown outcome is never
 * retried blindly. A real provider that is not explicitly configured to send leaves everything queued.
 */
export async function dispatchOutbox(deps: MessagingDeps, limit = 25): Promise<DispatchSummary> {
  const summary: DispatchSummary = { sent: 0, deferred: 0, suppressed: 0, failed: 0, retried: 0, blocked: null };
  const batchGate = sendGate(deps.provider, "+10000000000");
  // A paused or missing SMS provider holds SMS only. Messages to threads in Commons still go out.
  const smsBlocked = !batchGate.allowed;
  if (smsBlocked) { summary.blocked = batchGate.reason; if (deps.provider !== unconfiguredProvider) warn("commons.messaging.send_blocked", { reason: batchGate.reason, provider: deps.provider.name }); }
  for (const message of await claimDueOutbound(limit, { ...dbOptions(deps), ...(smsBlocked ? { providers: [webCarrier.name] } : {}) })) {
    try { await sendOne(deps, message, summary); }
    catch (error) {
      // Anything unexpected before the provider call is retried later; the claim lease also expires on its own.
      warn("commons.messaging.send_error", { messageId: message.id, error: error instanceof Error ? error.name : "unknown" });
      await recordSendResult(message.id, { ok: false, retryAt: message.attempts < MAX_ATTEMPTS ? new Date(deps.now().getTime() + BACKOFF_MS[Math.min(message.attempts - 1, BACKOFF_MS.length - 1)]!) : null, detail: "internal_error" }, dbOptions(deps));
      summary.retried++;
    }
  }
  return summary;
}

async function sendOne(deps: MessagingDeps, message: MessageRow, summary: DispatchSummary) {
  const options = dbOptions(deps), now = deps.now();
  const suppress = async (reason: string) => { await recordSendResult(message.id, { suppressed: reason }, options); summary.suppressed++; };
  const defer = async (reason: string, retryAt: Date | null) => {
    if (!retryAt) return suppress(reason);
    await recordSendResult(message.id, { suppressed: reason, retryAt }, options); summary.deferred++;
  };
  const e164 = await phoneNumberFor(message.phoneHash, options);
  if (!e164) return suppress("no_number");
  const kind = message.purpose.split(":")[0];

  if (kind !== "compliance") {
    if (message.personId) {
      const scope = ["proactive:change", "proactive:settlement", "proactive:organizer_share"].includes(message.purpose) ? "updates" : "conversation";
      const eligible = await sendEligibility({ personId: message.personId, commonsId: message.commonsId, phoneHash: message.phoneHash, scope }, options);
      if (!eligible.ok) return suppress(eligible.reason);
    } else {
      const eligible = await sendEligibility({ personId: "00000000-0000-4000-8000-000000000000", commonsId: null, phoneHash: message.phoneHash, scope: "conversation" }, options);
      if (!eligible.ok && eligible.reason === "opted_out") return suppress("opted_out");
    }
  }

  if (kind === "proactive" && message.personId) {
    const person = { id: message.personId, name: (await personAuth(message.personId, options))?.displayName ?? "" };
    const question = message.questionId ? await getQuestion(message.questionId, options) : null;
    // Suppression after resolution: whatever this was about may have been settled on the web, by another text, or by a changed date.
    if (message.questionId) {
      if (!question || question.status !== "open") return suppress("task_resolved");
      const state = await questionState(deps, question, person);
      if (state !== "open") { await closeQuestion(question.id, state === "resolved" ? "resolved_elsewhere" : "superseded", null, options); return suppress(state === "resolved" ? "task_resolved" : "task_changed"); }
    } else if (message.purpose === "proactive:settlement" && message.commonsId) {
      if (!(await openBalances(deps, message.personId, message.commonsId)).length) return suppress("task_resolved");
    } else if (message.purpose === "proactive:poll_link" && message.commonsId) {
      if (!(await pollNoticeStillNeeded(deps, message.personId, message.commonsId, (message.idempotencyKey ?? "").split(":").at(-1) ?? ""))) return suppress("task_resolved");
    }
    const trip = message.commonsId ? await tripInfo(message.commonsId, options) : null;
    if (trip && isQuietHours(now, trip.timezone)) return defer("quiet_hours", quietHoursEnd(now, trip.timezone));
    // An organizer's share is the organizer speaking, bounded per trip when it is written; Commons's own cadence doesn't hold it back.
    if (message.purpose !== "proactive:organizer_share") {
      const history = (await recentProactive(message.phoneHash, 7 * 86_400_000, options)).filter(item => item.questionKey !== message.idempotencyKey)
        .map(item => ({ at: item.at ?? now, commonsId: item.commonsId, questionKey: baseKey(item.questionKey) }));
      const cadence = cadenceDecision({ now, commonsId: message.commonsId ?? "", questionKey: baseKey(message.idempotencyKey), history, limits: message.purpose === "proactive:welcome" ? { ...DEFAULT_CADENCE, minGapMs: 0 } : DEFAULT_CADENCE });
      if (!cadence.allowed) return defer(cadence.reason, cadence.retryAt);
    }
  }

  const carrier = carrierFor(message.provider, deps.provider);
  const gate = sendGate(carrier, e164);
  if (!gate.allowed) return defer(gate.reason, new Date(now.getTime() + 15 * 60_000));
  try {
    const outcome = await carrier.send({ to: e164, body: message.body, idempotencyKey: message.idempotencyKey ?? message.id });
    await recordSendResult(message.id, { ok: true, providerMessageId: outcome.providerMessageId, status: "sent" }, options);
    summary.sent++;
  } catch (error) {
    if (!(error instanceof ProviderSendError)) throw error;
    warn("commons.messaging.send_failed", { messageId: message.id, code: error.code, retryable: error.retryable, unknownOutcome: error.unknownOutcome, attempt: message.attempts });
    if (error.retryable && !error.unknownOutcome && message.attempts < MAX_ATTEMPTS) {
      await recordSendResult(message.id, { ok: false, retryAt: new Date(now.getTime() + BACKOFF_MS[Math.min(message.attempts - 1, BACKOFF_MS.length - 1)]!), detail: error.code }, options);
      summary.retried++;
    } else {
      await recordSendResult(message.id, { ok: false, retryAt: null, detail: error.unknownOutcome ? "unknown_outcome_reconcile_before_retry" : error.code }, options);
      summary.failed++;
    }
  }
}

/** The scheduled pass: finish stored-but-unprocessed inbound messages, close expired questions, ask what is next, and send what is due. */
export async function runMessagingTick(deps: MessagingDeps) {
  let reprocessed = 0;
  for (const row of await unprocessedInbound(60_000, dbOptions(deps))) { try { await processInbound(deps, row.id); reprocessed++; } catch (error) { warn("commons.messaging.reprocess_failed", { messageId: row.id, error: error instanceof Error ? error.name : "unknown" }); } }
  const expired = await expireQuestions(dbOptions(deps));
  const asked = await planQuestions(deps);
  const dispatch = await dispatchOutbox(deps);
  return { reprocessed, expired, asked, dispatch };
}

/**
 * A poll was just published. Its people hear about it now rather than at the next scheduled pass. This can't affect publishing: it does nothing unless
 * texts can actually be sent, and a failure here is logged and goes no further.
 */
export async function textAboutPublishedPoll(pollId: string) {
  try {
    const deps = await messagingDeps({ allowNoProvider: true });
    const tripId = await tripIdForPoll(pollId, dbOptions(deps));
    if (!tripId) return;
    await planQuestionsForTrip(deps, tripId);
    await dispatchOutbox(deps);
  } catch (error) { warn("commons.messaging.poll_published_failed", { error: error instanceof Error ? error.name : "unknown" }); }
}

export { membershipAttendance };
