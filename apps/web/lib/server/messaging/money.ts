import {
  addCommonsExpense, closeQuestion, createMoneyIntake, createPaymentReport, getOwnMoneyIntake, openQuestion, supersedeMoneyIntakes, updateMoneyIntake, type EnrolledTrip, type MessagingMoneyDraft, type MoneyIntakeRow,
} from "@commons/database";
import { approvalCode, askedDate, equalShares, matchPerson, normalizeReply, parseAmount, parseApproval, parseMoneyMessage, QUESTION_TTL_MS, resolveCurrency, sanitizeInbound, type MoneyPerson } from "@commons/domain";
import { copyFor, dbOptions, queue, snapshotOf, tripUrl, type Conversation } from "./core";
import { deterministicUuid } from "./extraction";
import { ymd } from "./planner";

/*
 * Reporting money by text. Four things stay separate, as with bookings: what the message said, what's still missing, the exact version the person approved,
 * and the saved record, which only ever comes from the same Money commands the web form uses. Commons records; it never moves money, and a payment report
 * changes no balance until the person paid or an organizer records it.
 */
type Draft = MoneyIntakeRow["draft"];
const warn = (name: string, detail: Record<string, unknown>) => console.warn(name, detail);
const say = (c: Conversation, trip: EnrolledTrip, suffix: string, body: string, questionId?: string) => queue(c, { key: `reply:${c.message.id}:${suffix}`, purpose: `reply:money_${suffix}`, body, tripId: trip.id, questionId });
const moneyUrl = (c: Conversation, trip: EnrolledTrip) => tripUrl(c.deps, trip, "money");
const firstNameOf = (name: string) => name.trim().split(/\s+/)[0] ?? name;

async function activePeople(c: Conversation, trip: EnrolledTrip) {
  const snapshot = await snapshotOf(c.deps, trip.slug, c.person.id);
  return { snapshot, people: snapshot.participants.filter(person => person.membershipStatus === "active").map(person => ({ id: person.id, name: person.displayName })) as MoneyPerson[] };
}

function resolveDate(word: string | null, trip: EnrolledTrip, now: Date) {
  const today = ymd(now, trip.timezone);
  if (!word || ["today", "tonight", "this morning"].includes(word)) return { occurredOn: today, dateAssumed: !word };
  if (["yesterday", "last night"].includes(word)) return { occurredOn: new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10), dateAssumed: false };
  // A weekday just named means the most recent one, since this already happened. A date ahead of today isn't a cost anyone has paid yet.
  const asked = askedDate(word.slice(0, 3), { now, timezone: trip.timezone, startsOn: trip.startsOn, endsOn: trip.endsOn });
  if (!asked) return { occurredOn: today, dateAssumed: true };
  return { occurredOn: asked <= today ? asked : new Date(Date.parse(`${asked}T12:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10), dateAssumed: false };
}

/** Turn who-it-was-for words into people, or say exactly what to ask. */
function resolveIncluded(included: "everyone" | "unstated" | "unclear" | { names: string[]; includesSender: boolean }, people: readonly MoneyPerson[], senderId: string): { people: MoneyPerson[]; everyone: boolean } | { ask: string } {
  if (included === "unclear") return { ask: "Who was it for? Reply with names, or EVERYONE." };
  if (included === "everyone" || included === "unstated") return { people: [...people], everyone: true };
  const chosen = new Map<string, MoneyPerson>();
  if (included.includesSender) { const self = people.find(person => person.id === senderId); if (self) chosen.set(self.id, self); }
  for (const name of included.names) {
    const match = matchPerson(name, people);
    if (match.kind === "none") return { ask: `I don't see ${name} on this trip. Who was it for? Reply with names, or EVERYONE.` };
    if (match.kind === "ambiguous") return { ask: `Which ${name}: ${match.people.map(person => person.name).join(" or ")}? Reply with the full name, or EVERYONE.` };
    chosen.set(match.person.id, match.person);
  }
  return chosen.size ? { people: [...chosen.values()], everyone: chosen.size === people.length } : { ask: "Who was it for? Reply with names, or EVERYONE." };
}

function parseIncludedReply(text: string) {
  const normalized = normalizeReply(text);
  if (/^(everyone|everybody|all|all of us|the group|the whole group)$/.test(normalized)) return "everyone" as const;
  const parts = text.split(/\s*(?:,|&|\band\b)\s*/i).map(part => part.trim()).filter(Boolean);
  const names = parts.filter(part => !/^(me|myself)$/i.test(part));
  return { names, includesSender: names.length !== parts.length };
}

/** Ask for the one thing still missing, or send the summary to approve. */
async function advance(c: Conversation, trip: EnrolledTrip, intake: MoneyIntakeRow, askFirst: string | null) {
  const options = dbOptions(c.deps), draft = intake.draft;
  // Only one summary can wait at a time. If this replaces another, the person hears about it rather than losing it silently.
  const replaced = await supersedeMoneyIntakes(c.person.id, trip.id, intake.id, options);
  const lead = replaced ? "This replaces the one you hadn't saved. " : "";
  const missing = askFirst ? intake.missing : !draft.amountCents ? "amount" : draft.kind === "expense" && !draft.description ? "description" : draft.kind === "payment" && !draft.toPersonId ? "person" : null;
  if (missing) {
    const question = lead + (askFirst ?? (missing === "amount" ? (draft.kind === "payment" ? "How much did you pay?" : "What was the total?") : missing === "description" ? "What was it for?" : "Who did you pay?"));
    const row = (await updateMoneyIntake(intake.id, intake.version, { status: "needs_info", missing, draft }, options)) ?? intake;
    const open = await openQuestion({ personId: c.person.id, commonsId: trip.id, kind: "money_info", refId: row.id, version: String(row.version), expiresAt: new Date(c.deps.now().getTime() + QUESTION_TTL_MS) }, options);
    await say(c, trip, "ask", copyFor(c.e164).moneyAsk(trip.name, question), open.id);
    return;
  }
  const row = (await updateMoneyIntake(intake.id, intake.version, { status: "awaiting_review", missing: null, draft }, { ...options, bumpVersion: true }))!;
  if (!row) return;
  const code = approvalCode(row.id, row.version);
  const open = await openQuestion({ personId: c.person.id, commonsId: trip.id, kind: "money_review", refId: row.id, version: String(row.version), approvalCode: code, expiresAt: new Date(c.deps.now().getTime() + QUESTION_TTL_MS) }, options);
  const amount = copyFor(c.e164).money(draft.amountCents!, draft.currency!);
  const withLead = (body: string) => replaced ? body.replace(`${trip.name}: `, `${trip.name}: ${lead}`) : body;
  if (draft.kind === "payment") { await say(c, trip, "review", withLead(copyFor(c.e164).moneyPaymentReview({ tripName: trip.name, amount, currencyAssumed: !parsedCurrencyWasStated(row), currency: draft.currency!, toName: draft.toName!, code })), open.id); return; }
  const expense = draft as Extract<MessagingMoneyDraft, { kind: "expense" }>;
  const { snapshot } = await activePeople(c, trip);
  const duplicate = (snapshot.state.expenses ?? []).some(saved => saved.paidByPersonId === c.person.id && saved.amountCents === expense.amountCents && saved.currency === expense.currency && saved.occurredOn === expense.occurredOn && normalizeReply(saved.title) === normalizeReply(expense.description));
  const everyoneNames = expense.includedNames.map(firstNameOf).join(", ");
  await say(c, trip, "review", withLead(copyFor(c.e164).moneyExpenseReview({ tripName: trip.name, description: expense.description, amount, day: new Date(`${expense.occurredOn}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }), dayAssumed: expense.dateAssumed, currencyAssumed: expense.currencyAssumed, currency: expense.currency, people: everyoneNames, perPerson: expense.includedPersonIds.length > 1 ? copyFor(c.e164).money(Math.round(expense.amountCents / expense.includedPersonIds.length), expense.currency) : null, duplicate, code })), open.id);
}
const parsedCurrencyWasStated = (intake: MoneyIntakeRow) => !(intake.draft as { currencyAssumed?: boolean }).currencyAssumed;

/**
 * A new report in this message, or false so the caller treats it as ordinary conversation. The sender is the payer: that's the only thing a verified number
 * proves. A message that says someone else paid goes to the Money page.
 */
export async function handleMoneyMessage(c: Conversation, trip: EnrolledTrip): Promise<boolean> {
  const body = sanitizeInbound(c.message.body), parsed = parseMoneyMessage(body);
  if (!parsed) return false;
  if (parsed.kind === "someone_else") { await say(c, trip, "elsewhere", copyFor(c.e164).moneySomeoneElse(trip.name, moneyUrl(c, trip))); return true; }
  const { people } = await activePeople(c, trip);
  const others = people.filter(person => person.id !== c.person.id);
  const { currency, currencyAssumed } = resolveCurrency(parsed, trip.currency);
  let draft: Draft, missing: string | null = null, askFirst: string | null = null;
  if (parsed.kind === "payment") {
    const match = parsed.toName ? matchPerson(parsed.toName, others) : null;
    // "I paid attention" is nobody and no amount: not a report. A real amount to an unknown name is worth asking about.
    if (match?.kind === "none" && !parsed.amountCents) return false;
    draft = { kind: "payment", amountCents: parsed.amountCents ?? undefined, currency, occurredOn: ymd(c.deps.now(), trip.timezone), currencyAssumed, ...(match?.kind === "one" ? { toPersonId: match.person.id, toName: firstNameOf(match.person.name) } : {}) } as Draft;
    if (!match) { missing = "person"; askFirst = "Who did you pay?"; }
    else if (match.kind === "none") { missing = "person"; askFirst = `I don't see ${parsed.toName} on this trip. Who did you pay?`; }
    else if (match.kind === "ambiguous") { missing = "person"; askFirst = `Which ${match.name}: ${match.people.map(person => person.name).join(" or ")}? Reply with the full name.`; }
  } else {
    const resolved = resolveIncluded(parsed.included, people, c.person.id);
    const date = resolveDate(parsed.dateWord, trip, c.deps.now());
    draft = { kind: "expense", description: parsed.description ?? undefined, amountCents: parsed.amountCents ?? undefined, currency, currencyAssumed, paidByPersonId: c.person.id, ...date, ...("people" in resolved ? { includedPersonIds: resolved.people.map(person => person.id), includedNames: resolved.people.map(person => person.name), everyone: resolved.everyone } : {}) } as Draft;
    if ("ask" in resolved) { missing = "people"; askFirst = resolved.ask; }
  }
  const intake = await createMoneyIntake({ personId: c.person.id, commonsId: trip.id, status: "needs_info", sourceText: body, draft, missing, receivedMessageId: c.message.id }, dbOptions(c.deps));
  await advance(c, trip, intake, askFirst);
  return true;
}

/** A reply to "how much was it?" or "who was it for?". Anything that can't fill the blank asks again, and DISCARD drops the report. */
export async function answerMoneyInfo(c: Conversation, trip: EnrolledTrip, question: { id: string; refId: string | null; version: string }) {
  const options = dbOptions(c.deps), intake = question.refId ? await getOwnMoneyIntake(question.refId, c.person.id, options) : null;
  if (!intake || intake.status !== "needs_info" || String(intake.version) !== question.version) { await closeQuestion(question.id, "superseded", null, options); await say(c, trip, "stale", copyFor(c.e164).versionChanged(trip.name)); return; }
  const text = sanitizeInbound(c.message.body).trim();
  if (parseApproval(text).action === "decline") {
    await updateMoneyIntake(intake.id, intake.version, { status: "declined" }, options); await closeQuestion(question.id, "cancelled", null, options);
    await say(c, trip, "discarded", copyFor(c.e164).moneyDiscarded(trip.name)); return;
  }
  const draft = { ...intake.draft } as Record<string, unknown> & Draft;
  const again = (ask: string) => say(c, trip, "ask_again", copyFor(c.e164).moneyAsk(trip.name, ask));
  if (intake.missing === "amount") {
    const amount = parseAmount(text, { allowBare: true });
    if (!amount) { await again("How much? Reply with the amount, like $40."); return; }
    draft.amountCents = amount.amountCents;
    if (amount.currency || amount.dollarSign) Object.assign(draft, resolveCurrency(amount, trip.currency));
  } else if (intake.missing === "description") {
    const description = text.replace(/\s+/g, " ").slice(0, 120);
    if (description.length < 2) { await again("What was it for?"); return; }
    draft.description = description[0]!.toUpperCase() + description.slice(1);
  } else if (intake.missing === "person") {
    const { people } = await activePeople(c, trip), match = matchPerson(text, people.filter(person => person.id !== c.person.id));
    if (match.kind !== "one") { await again(match.kind === "ambiguous" ? `Which ${match.name}: ${match.people.map(person => person.name).join(" or ")}? Reply with the full name.` : "Who did you pay? Reply with a name from the trip."); return; }
    draft.toPersonId = match.person.id; draft.toName = firstNameOf(match.person.name);
  } else if (intake.missing === "people") {
    const { people } = await activePeople(c, trip), resolved = resolveIncluded(parseIncludedReply(text), people, c.person.id);
    if ("ask" in resolved) { await again(resolved.ask); return; }
    draft.includedPersonIds = resolved.people.map(person => person.id); draft.includedNames = resolved.people.map(person => person.name); draft.everyone = resolved.everyone;
  }
  await closeQuestion(question.id, "answered", null, options);
  const updated = await updateMoneyIntake(intake.id, intake.version, { draft, missing: null }, options);
  if (updated) await advance(c, trip, updated, null);
}

/** SAVE <code> runs the same command the web form uses, once, for exactly the version that was shown. */
export async function answerMoneyReview(c: Conversation, trip: EnrolledTrip, question: { id: string; refId: string | null; version: string; approvalCode: string | null }) {
  const options = dbOptions(c.deps), approval = parseApproval(c.message.body), intake = question.refId ? await getOwnMoneyIntake(question.refId, c.person.id, options) : null;
  if (!intake || intake.status !== "awaiting_review" || String(intake.version) !== question.version) { await closeQuestion(question.id, "superseded", null, options); await say(c, trip, "stale", copyFor(c.e164).versionChanged(trip.name)); return; }
  if (approval.action === "decline") {
    await updateMoneyIntake(intake.id, intake.version, { status: "declined" }, options); await closeQuestion(question.id, "cancelled", null, options);
    await say(c, trip, "discarded", copyFor(c.e164).moneyDiscarded(trip.name)); return;
  }
  if (approval.action !== "save") { await say(c, trip, "remind", `${trip.name}: to save, reply SAVE ${question.approvalCode}. Reply DISCARD to drop it.`); return; }
  const actor = { databaseUrl: c.deps.databaseUrl, actorPersonId: c.person.id };
  const draft = intake.draft as MessagingMoneyDraft;
  try {
    if (draft.kind === "payment") {
      const report = await createPaymentReport(trip.slug, { commandId: deterministicUuid(`sms:money:${intake.id}:${intake.version}`), toPersonId: draft.toPersonId, currency: draft.currency, amountCents: draft.amountCents, note: "Reported by text" }, actor);
      await updateMoneyIntake(intake.id, intake.version, { status: "saved", recordId: report.id }, options);
      await closeQuestion(question.id, "answered", null, options);
      await say(c, trip, "saved", copyFor(c.e164).moneyPaymentSaved(trip.name, draft.toName, moneyUrl(c, trip)));
      return;
    }
    const { snapshot } = await activePeople(c, trip);
    const tracking = Boolean(snapshot.commons.balancesDisabled);
    await addCommonsExpense(trip.slug, {
      commandId: deterministicUuid(`sms:money:${intake.id}:${intake.version}`), title: draft.description, currency: draft.currency, amountCents: draft.amountCents, paidByPersonId: c.person.id, occurredOn: draft.occurredOn, category: "Other", splitMethod: "equal",
      balanceMode: tracking ? "tracking_only" : "allocated", shares: tracking ? draft.includedPersonIds.map(personId => ({ personId, amountCents: 0 })) : equalShares(draft.amountCents, draft.includedPersonIds), note: "Added by text",
    }, actor);
    await updateMoneyIntake(intake.id, intake.version, { status: "saved" }, options);
    await closeQuestion(question.id, "answered", null, options);
    await say(c, trip, "saved", copyFor(c.e164).moneyExpenseSaved(trip.name, draft.description, moneyUrl(c, trip)));
  } catch (error) {
    // A closed ledger, a member who left, a limit: every rule of the existing command still applies. The draft stays for a retry and nothing was saved.
    warn("commons.messaging.money_save_failed", { error: error instanceof Error ? error.name : "unknown" });
    await say(c, trip, "failed", copyFor(c.e164).moneyFailed(trip.name, moneyUrl(c, trip)));
  }
}
