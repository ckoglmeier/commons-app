import { randomUUID } from "node:crypto";
import { addCommonsPerson, createCommonsDraft, createCommonsPoll, createDatabase, itineraryItems, listCommonsMembershipsForPerson, personAuth, stayParticipants, stays, verifiedPhoneFor, withdrawFromTrip } from "@commons/database";
import { authenticatedConfirmationIntakeOptions } from "../commons";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError } from "../commons-access-errors";
import { inAppThreadEnabledFor } from "../runtime-environment";
import { messagingDeps } from "./core";
import { viewerEmail } from "./test-thread";
import { enroll } from "./web";

/*
 * One tap to a trip worth texting about, for the accounts allowed the test thread. It's an ordinary private trip the tester organizes, with a
 * fictional traveler named Sam (no account, nobody is contacted), a dinner with an address, an activity, a stay and a one-question poll.
 * The tap is the tester turning texts on for it, and an older test trip's texts are turned off so the thread is about one trip at a time.
 */
export const TEST_TRIP_NAME = "Text test trip";
const TEST_TRIP_SLUG = "text-test-trip-";
const TIMEZONE = "America/Denver";

const ymdIn = (date: Date, timezone: string) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
const addDays = (ymd: string, days: number) => new Date(Date.parse(`${ymd}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
/** The instant a wall-clock time on a date happens in a time zone. */
export function zonedInstant(ymd: string, hour: number, timezone: string) {
  const guess = Date.parse(`${ymd}T${String(hour).padStart(2, "0")}:00:00Z`);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(guess)).map(part => [part.type, part.value]));
  const shown = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return new Date(guess - (shown - guess));
}

export async function createTestTrip() {
  const options = await authenticatedConfirmationIntakeOptions();
  const now = (await messagingDeps()).now();
  const email = await viewerEmail();
  if (!inAppThreadEnabledFor(email)) throw new CommonsMembershipRequiredError();
  const me = options.actorPersonId, url = options.databaseUrl;
  if (!await verifiedPhoneFor(me, { databaseUrl: url })) throw new CommonsMembershipRequiredError();
  const person = await personAuth(me, { databaseUrl: url });
  if (!person?.authUserId) throw new CommonsAuthenticationRequiredError();
  const identity = { authUserId: person.authUserId, ...(email ? { email } : {}) };
  const earlier = (await listCommonsMembershipsForPerson(me, url)).filter(trip => trip.commons.slug.startsWith(TEST_TRIP_SLUG));
  for (const trip of earlier) await withdrawFromTrip({ personId: me, commonsId: trip.commons.id, reason: "new_test_trip" }, { databaseUrl: url });

  const today = ymdIn(now, TIMEZONE), tomorrow = addDays(today, 1), last = addDays(today, 2);
  const displayName = person.displayName?.trim() || "Test organizer";
  const { commonsId, slug } = await createCommonsDraft({ organizerDisplayName: displayName, name: TEST_TRIP_NAME, startsOn: today, endsOn: last, locationName: "Denver, Colorado", timezone: TIMEZONE }, identity, url);
  const repository = { databaseUrl: url, actorPersonId: me };
  const sam = await addCommonsPerson(slug, { displayName: "Sam", accessMode: "managed" }, repository);

  const database = createDatabase(url);
  try {
    await database.db.insert(itineraryItems).values([
      { commonsId, title: "Dinner at Test Kitchen", startsAt: zonedInstant(tomorrow, 19, TIMEZONE), timezone: TIMEZONE, locationName: "123 Example St, Denver, CO", audience: "everyone", status: "confirmed", mealType: "restaurant", provenanceLabel: "Added for the text test" },
      { commonsId, title: "Morning hike", startsAt: zonedInstant(tomorrow, 9, TIMEZONE), timezone: TIMEZONE, locationName: "Example Trailhead", audience: "everyone", status: "planned", provenanceLabel: "Added for the text test" },
    ]);
    const [stay] = await database.db.insert(stays).values({ commonsId, createdByPersonId: me, name: "Test Cabin", address: "1 Example Rd, Denver, CO", startsOn: today, endsOn: last, status: "confirmed", sourceLabel: "Added for the text test" }).returning({ id: stays.id });
    await database.db.insert(stayParticipants).values([me, sam.personId!].map(personId => ({ stayId: stay!.id, personId })));
  } finally { await database.close(); }

  const question = { id: randomUUID(), kind: "choice", prompt: "What should we eat on the last night?", required: true, selectionMode: "single", options: ["Pizza", "Tacos", "Cook at the cabin"].map(label => ({ id: randomUUID(), label, exclusive: false })) };
  await createCommonsPoll(slug, { commandId: randomUUID(), title: "Last night", ballotMode: "transparent", audience: { personIds: [me], guestEmails: [] }, questions: [question] }, repository);

  const enrolled = await enroll(slug, { consent: true });
  if (!enrolled.ok) throw new Error(enrolled.message);
  return { slug, name: TEST_TRIP_NAME };
}
