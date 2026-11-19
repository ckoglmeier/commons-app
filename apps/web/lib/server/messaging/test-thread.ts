import { enrolledTripsForNumber, listCommonsMembershipsForPerson, pendingVerificationMessages, recordInbound, threadForPhone, touchPhone, verifiedPhoneFor } from "@commons/database";
import { sanitizeInbound } from "@commons/domain";
import { z } from "zod";
import { authenticatedConfirmationIntakeOptions, getCurrentCommonsIdentity } from "../commons";
import { CommonsMembershipRequiredError } from "../commons-access-errors";
import { inAppThreadEnabledFor, textMessagingAvailable } from "../runtime-environment";
import { dbOptions, messagingDeps } from "./core";
import { dispatchOutbox } from "./dispatch";
import { processInbound } from "./inbound";
import { testNumberFor } from "./in-app-provider";
import { planQuestionsForTrip } from "./planner";

/*
 * The in-app stand-in for a phone. A reply here enters at exactly the point a provider's webhook would hand over: stored, then processed by the same code.
 * The person comes only from the signed-in session and the number only from their own verified identity, so nobody can write as, or read, another number.
 */
export const ThreadMessageSchema = z.object({ id: z.string().uuid(), body: z.string().trim().min(1).max(1600) });

let emailForTests: string | null = null;
/** Test seam: the synthetic actor has no sign-in email. Production code never calls this. */
export function setViewerEmailForTests(email: string | null) { emailForTests = email; }
export const viewerEmail = async () => emailForTests ?? (await getCurrentCommonsIdentity())?.email ?? null;

/** Can this signed-in person use texting at all? Real SMS is for everyone once it's on; the test thread is only for the accounts listed. */
export async function textMessagingAvailableToViewer() {
  if (textMessagingAvailable()) return true;
  if (process.env.COMMONS_SMS_PROVIDER !== "in_app") return false;
  return inAppThreadEnabledFor(await viewerEmail());
}

async function viewer() {
  const options = await authenticatedConfirmationIntakeOptions();
  if (!inAppThreadEnabledFor(await viewerEmail())) throw new CommonsMembershipRequiredError();
  const deps = await messagingDeps();
  return { options, deps, e164: await verifiedPhoneFor(options.actorPersonId, dbOptions(deps)) };
}

/** What the thread screen shows. A queued or held-back message says so; only what actually went out looks sent. */
export async function readTestThread() {
  const { options, deps, e164 } = await viewer();
  const trips = await listCommonsMembershipsForPerson(options.actorPersonId, options.databaseUrl);
  const enrolled = e164 ? (await enrolledTripsForNumber(e164, dbOptions(deps))).trips.map(trip => trip.id) : [];
  // Before a number is confirmed, the only thing to show is the person's own code, which this screen is the only way to read.
  const messages = e164 ? await threadForPhone(e164, 200, dbOptions(deps)) : await pendingVerificationMessages(options.actorPersonId, deps.provider.name, dbOptions(deps));
  return {
    phone: e164, suggestedPhone: testNumberFor(options.actorPersonId),
    trips: trips.map(trip => ({ id: trip.commons.id, name: trip.commons.name, enrolled: enrolled.includes(trip.commons.id) })),
    messages: messages.map(message => ({ id: message.id, from: message.direction === "inbound" ? "you" as const : "commons" as const, body: message.body, status: message.status, detail: message.statusDetail, waitingUntil: message.status === "queued" ? message.nextAttemptAt?.toISOString() ?? null : null, at: message.createdAt.toISOString() })),
  };
}

/** A reply from the signed-in person. The client's id makes a double-tap one message, the way a provider's message id does. */
export async function sendTestThreadMessage(raw: unknown) {
  const input = ThreadMessageSchema.parse(raw), { options, deps, e164 } = await viewer();
  if (!e164) throw new CommonsMembershipRequiredError();
  await touchPhone(e164, { inbound: true }, dbOptions(deps));
  const recorded = await recordInbound({ provider: deps.provider.name, providerMessageId: input.id, e164, personId: options.actorPersonId, body: sanitizeInbound(input.body, 1600), media: [] }, dbOptions(deps));
  if (recorded.created) await processInbound(deps, recorded.message.id);
  await dispatchOutbox(deps);
}

/** What the scheduled pass would do for this person's trips, on demand, so a tester doesn't wait a day. Quiet hours and cadence still hold. */
export async function checkTestThread() {
  const { deps, e164 } = await viewer();
  if (!e164) return;
  for (const trip of (await enrolledTripsForNumber(e164, dbOptions(deps))).trips) await planQuestionsForTrip(deps, trip.id);
  await dispatchOutbox(deps);
}
