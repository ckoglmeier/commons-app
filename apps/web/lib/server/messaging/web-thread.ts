import {
  consentedMembers, consentedNumber, enrolledTripsForNumber, enrollmentStatus, enrollPersonInTrip, getCommonsSnapshot, listCommonsMembershipsForPerson, membershipAttendance, MessagingEnrollmentError,
  organizerSharesSince, personAuth, recordInbound, threadForPhone, touchPhone, tripTextingFunded, webAddressFor, withdrawFromTrip,
} from "@commons/database";
import { ORGANIZER_SHARE_MAX_LENGTH, ORGANIZER_SHARES_PER_DAY, sanitizeInbound, WEB_MESSAGES_CONSENT_TEXT, WEB_MESSAGES_CONSENT_WORDING } from "@commons/domain";
import { z } from "zod";
import { authenticatedConfirmationIntakeOptions } from "../commons";
import { CommonsMembershipRequiredError } from "../commons-access-errors";
import { webMessagesEnabledFor } from "../runtime-environment";
import { copyFor, dbOptions, messagingDeps, queue } from "./core";
import { dispatchOutbox } from "./dispatch";
import { processInbound } from "./inbound";
import { askNextFor, queueWelcome } from "./planner";
import { viewerEmail } from "./test-thread";

/*
 * Messages with Commons on the web: the text conversation, in a person's own thread in Commons, with no phone. Everything after "a message arrived"
 * is the code texting uses: routing, consent, quiet hours, cadence, funding and approvals. The person and their address come only from the signed-in
 * session, so nobody can read or write another person's thread.
 */
export const WebThreadMessageSchema = z.object({ id: z.string().uuid(), body: z.string().trim().min(1).max(1600) });
export const OrganizerShareSchema = z.object({ id: z.string().uuid(), body: z.string().trim().min(1).max(ORGANIZER_SHARE_MAX_LENGTH) });

export async function webMessagesAvailableToViewer() { return webMessagesEnabledFor(await viewerEmail()); }

async function viewer() {
  const options = await authenticatedConfirmationIntakeOptions();
  if (!webMessagesEnabledFor(await viewerEmail())) throw new CommonsMembershipRequiredError();
  const deps = await messagingDeps({ allowNoProvider: true });
  return { options, deps, address: webAddressFor(options.actorPersonId) };
}

async function tripFor(slug: string, options: Awaited<ReturnType<typeof authenticatedConfirmationIntakeOptions>>) {
  const snapshot = await getCommonsSnapshot(slug, options);
  if (!snapshot) throw new CommonsMembershipRequiredError();
  return snapshot.commons;
}

/** The person's thread, after Commons catches up on anything due for their trips (quiet hours and cadence still hold). */
export async function readWebThread() {
  const { options, deps, address } = await viewer();
  const state = await enrolledTripsForNumber(address, dbOptions(deps));
  // Catching up is a nicety, and only for the viewer's own next step: reading your thread never depends on it.
  try { for (const trip of state.trips) await askNextFor(deps, { personId: options.actorPersonId, commonsId: trip.id }); }
  catch (error) { console.warn("commons.messaging.catch_up_plan_failed", { error: error instanceof Error ? error.name : "unknown" }); }
  try { await dispatchOutbox(deps); }
  catch (error) { console.warn("commons.messaging.catch_up_dispatch_failed", { error: error instanceof Error ? error.name : "unknown" }); }
  const memberships = await listCommonsMembershipsForPerson(options.actorPersonId, options.databaseUrl);
  // What Commons has said appears once it goes out, as it would on a phone: something held for quiet hours or pacing isn't shown early.
  const messages = (await threadForPhone(address, 200, dbOptions(deps))).filter(message => message.direction === "inbound" || ["sent", "delivered"].includes(message.status));
  return {
    optedOut: state.optedOut,
    trips: memberships.map(item => ({ id: item.commons.id, name: item.commons.name, on: state.trips.some(trip => trip.id === item.commons.id) })),
    // In the order the person saw them: a message held overnight sits where it went out, not where it was written.
    messages: messages.map(message => ({ id: message.id, from: message.direction === "inbound" ? "you" as const : "commons" as const, body: message.body, at: (message.direction === "outbound" ? message.sentAt ?? message.createdAt : message.createdAt).toISOString() }))
      .sort((a, b) => a.at.localeCompare(b.at)),
  };
}

/** A reply from the signed-in person, entering exactly where a provider's inbound message would. The client id makes a double tap one message. */
export async function sendWebThreadMessage(raw: unknown) {
  const input = WebThreadMessageSchema.parse(raw), { options, deps, address } = await viewer();
  await touchPhone(address, { inbound: true }, dbOptions(deps));
  const recorded = await recordInbound({ provider: "web", providerMessageId: `${options.actorPersonId}:${input.id}`, e164: address, personId: options.actorPersonId, body: sanitizeInbound(input.body, 1600), media: [] }, dbOptions(deps));
  if (recorded.created) await processInbound(deps, recorded.message.id);
  await dispatchOutbox(deps);
}

/** Where this person's messages for one trip go, and what they may do from the trip page. */
export async function readWebMessagesForTrip(slug: string) {
  const { options, deps } = await viewer();
  const trip = await tripFor(slug, options);
  const status = await enrollmentStatus(options.actorPersonId, trip.id, dbOptions(deps));
  const member = await membershipAttendance(options.actorPersonId, trip.id, dbOptions(deps));
  return {
    tripName: trip.name, consentText: WEB_MESSAGES_CONSENT_TEXT(trip.name),
    on: status.enrolled && status.onWeb, onPhone: status.enrolled && !status.onWeb,
    funded: await tripTextingFunded(trip.id, dbOptions(deps)),
    organizer: member?.role === "organizer",
  };
}

export async function setWebMessagesForTrip(slug: string, on: boolean): Promise<{ ok: true } | { ok: false; code: MessagingEnrollmentError["code"]; message: string }> {
  const { options, deps, address } = await viewer();
  const trip = await tripFor(slug, options);
  if (!on) {
    // Only turns off what is in the web thread; a trip whose messages go to a phone is managed there.
    const status = await enrollmentStatus(options.actorPersonId, trip.id, dbOptions(deps));
    if (status.onWeb) await withdrawFromTrip({ personId: options.actorPersonId, commonsId: trip.id, reason: "web_thread_off" }, dbOptions(deps));
    return { ok: true };
  }
  try { await enrollPersonInTrip({ personId: options.actorPersonId, commonsId: trip.id, e164: address, wording: WEB_MESSAGES_CONSENT_WORDING }, dbOptions(deps)); }
  catch (error) { if (error instanceof MessagingEnrollmentError) return { ok: false, code: error.code, message: error.message }; throw error; }
  const auth = await personAuth(options.actorPersonId, dbOptions(deps));
  await queueWelcome(deps, { id: options.actorPersonId, name: auth?.displayName ?? "" }, trip.id);
  await dispatchOutbox(deps);
  return { ok: true };
}

export type ShareResult = { ok: true; recipients: number } | { ok: false; code: "organizer_only" | "trip_not_funded" | "share_limit"; message: string };

/**
 * An organizer's short message, posted by Commons into the thread of every traveler who has messages on for the trip (web or phone), with the
 * organizer's name on it. Replies go to Commons, as with anything else in the thread. At most a few a day per trip; quiet hours hold.
 */
export async function shareWithTravelers(slug: string, raw: unknown): Promise<ShareResult> {
  const input = OrganizerShareSchema.parse(raw), { options, deps } = await viewer();
  const trip = await tripFor(slug, options);
  const member = await membershipAttendance(options.actorPersonId, trip.id, dbOptions(deps));
  if (member?.role !== "organizer" || member.status !== "active") return { ok: false, code: "organizer_only", message: "Only an organizer can share a message with the group." };
  if (!await tripTextingFunded(trip.id, dbOptions(deps))) return { ok: false, code: "trip_not_funded", message: "Messages start once this trip's fee is paid." };
  const since = new Date(deps.now().getTime() - 86_400_000);
  if (await organizerSharesSince(trip.id, since, dbOptions(deps)) >= ORGANIZER_SHARES_PER_DAY) return { ok: false, code: "share_limit", message: `You can share ${ORGANIZER_SHARES_PER_DAY} messages a day on a trip. Try again tomorrow.` };
  const organizer = (await personAuth(options.actorPersonId, dbOptions(deps)))?.displayName?.trim() || "An organizer";
  let recipients = 0;
  for (const { personId } of await consentedMembers(trip.id, dbOptions(deps))) {
    if (personId === options.actorPersonId) continue;
    const number = await consentedNumber(personId, trip.id, "updates", dbOptions(deps));
    if (!number) continue;
    // The organizer's words are a value in the share, so they arrive exactly as written on a phone or in a thread.
    const body = copyFor(number.e164).organizerShare(trip.name, organizer, input.body);
    await queue({ deps, e164: number.e164, person: { id: personId, name: "" } }, { key: `share:${input.id}:${personId}`, purpose: "proactive:organizer_share", body, tripId: trip.id });
    recipients++;
  }
  await dispatchOutbox(deps);
  return { ok: true, recipients };
}
