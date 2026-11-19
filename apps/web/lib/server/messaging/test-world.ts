/*
 * Test-only world for the messaging integration tests: a disposable database, synthetic people and trips, a fake provider and a controllable
 * clock. Everything here is synthetic evidence; no message ever leaves the process. Never import from production code.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  commons, createDatabase, identities, memberships, messagingMessages, messagingPhones, messagingWebhookEvents, people, phoneHashOf, stayParticipants, stays, travelPlans,
} from "@commons/database";
import { actAs, databaseTestsEnabled, testDatabaseUrl } from "../coordinator-route-harness";
import { registerComponentImportStubs } from "../../test-support/hook-harness";
import { FakeProvider } from "./fake-provider";
import { setMessagingProviderForTests } from "./provider";

export { actAs, databaseTestsEnabled, testDatabaseUrl };
export const skip = !databaseTestsEnabled;
const uniquePhone = () => `+1415555${String(Math.floor(1000 + Math.random() * 8999))}`;

export type Routes = Awaited<ReturnType<typeof loadRoutes>>;
export async function loadRoutes() {
  registerComponentImportStubs();
  const [inbound, status, tick, enrollment, review, source, admin] = await Promise.all([
    import("../../../app/api/v1/messaging/inbound/route"),
    import("../../../app/api/v1/messaging/status/route"),
    import("../../../app/api/internal/messaging/route"),
    import("../../../app/api/v1/commons/[slug]/messaging/route"),
    import("../../../app/api/v1/messaging/review/[token]/route"),
    import("../../../app/api/v1/messaging/review/[token]/source/route"),
    import("../../../app/api/v1/admin/messaging/route"),
  ]);
  return { inbound, status, tick, enrollment, review, source, admin };
}

export type World = Awaited<ReturnType<typeof world>>;

/** Maya and Sam are travelers with verified numbers on every trip; Casey organizes. `Sonoma Weekend` is in June 2027 and `Tahoe Ski Weekend` in December 2027. */
export async function world(options: { trips?: Array<"sonoma" | "tahoe"> } = {}) {
  registerComponentImportStubs(); // `server-only` must be stubbed before any module that imports it loads
  const { setMessagingDepsForTests } = await import("./core");
  process.env.COMMONS_BETA_REWORK_ENABLED = "true";
  process.env.COMMONS_INVITATION_TOKEN_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  process.env.NEXT_PUBLIC_SITE_URL = "https://commons.test";
  process.env.CRON_SECRET = "synthetic-cron-secret-0001";
  delete process.env.COMMONS_SMS_PROVIDER;
  const url = testDatabaseUrl();
  // A crashed earlier run must not leave synthetic messages for this run's dispatcher to pick up: the outbox is global by design.
  const purge = createDatabase(url);
  try {
    await purge.db.delete(messagingMessages).where(eq(messagingMessages.provider, "fake"));
    await purge.db.delete(messagingWebhookEvents).where(eq(messagingWebhookEvents.provider, "fake"));
  } finally { await purge.close(); }
  const provider = new FakeProvider();
  let nowMs = Date.parse("2026-11-04T19:00:00Z"); // 11:00 in Los Angeles, outside quiet hours
  const stored: Array<{ path: string; bytes: Uint8Array; mimeType: string }> = [];
  const state = { extractor: undefined as import("./extraction").BookingExtractor | undefined, provider: provider as import("./provider").MessagingProvider };
  const apply = () => setMessagingDepsForTests({ provider: state.provider, now: () => new Date(++nowMs), /* time moves forward between reads, as it does outside tests; two messages never share a timestamp */ origin: "https://commons.test", mediaStore: { put: async (path, bytes, mimeType) => { stored.push({ path, bytes, mimeType }); } }, ...(state.extractor ? { extractor: state.extractor } : {}) });
  setMessagingProviderForTests(provider);
  apply();

  const ids = { maya: randomUUID(), sam: randomUUID(), casey: randomUUID(), sonoma: randomUUID(), tahoe: randomUUID() };
  const phones = { maya: uniquePhone(), sam: uniquePhone(), casey: uniquePhone(), stranger: uniquePhone() };
  const slugs = { sonoma: `sms-sonoma-${ids.sonoma.slice(0, 8)}`, tahoe: `sms-tahoe-${ids.tahoe.slice(0, 8)}` };
  const wanted = options.trips ?? ["sonoma"];
  const db = createDatabase(url);
  try {
    await db.db.insert(people).values([
      { id: ids.maya, displayName: "Maya Synthetic", authUserId: ids.maya }, { id: ids.sam, displayName: "Sam Synthetic", authUserId: ids.sam }, { id: ids.casey, displayName: "Casey Synthetic", authUserId: ids.casey },
    ]);
    const verified = { kind: "phone" as const, state: "channel_verified" as const, verifiedAt: new Date() };
    await db.db.insert(identities).values([{ personId: ids.maya, normalizedHash: phoneHashOf(phones.maya), ...verified }, { personId: ids.sam, normalizedHash: phoneHashOf(phones.sam), ...verified }, { personId: ids.casey, normalizedHash: phoneHashOf(phones.casey), ...verified }]);
    const trips = { sonoma: { id: ids.sonoma, slug: slugs.sonoma, name: "Sonoma Weekend", startsOn: "2027-06-11", endsOn: "2027-06-13", timezone: "America/Los_Angeles" }, tahoe: { id: ids.tahoe, slug: slugs.tahoe, name: "Tahoe Ski Weekend", startsOn: "2027-12-03", endsOn: "2027-12-05", timezone: "America/Denver" } };
    for (const key of wanted) {
      const trip = trips[key];
      await db.db.insert(commons).values({ ...trip, locationName: key === "sonoma" ? "Sonoma, California" : "Lake Tahoe", createdByPersonId: ids.casey });
      await db.db.insert(memberships).values([ids.casey, ids.maya, ids.sam].map(personId => ({ commonsId: trip.id, personId, role: personId === ids.casey ? "organizer" as const : "member" as const, status: "active" as const })));
    }
  } finally { await db.close(); }

  const q = async <T>(read: (db: ReturnType<typeof createDatabase>["db"]) => Promise<T>) => { const handle = createDatabase(url); try { return await read(handle.db); } finally { await handle.close(); } };
  let counter = 0;
  const world = {
    url, provider, ids, phones, slugs, stored, q,
    setExtractor(extractor: import("./extraction").BookingExtractor | undefined) { state.extractor = extractor; apply(); },
    useProvider(next: import("./provider").MessagingProvider) { state.provider = next; setMessagingProviderForTests(next); apply(); },
    clock: { set(iso: string) { nowMs = Date.parse(iso); }, advance(ms: number) { nowMs += ms; }, get now() { return new Date(nowMs); } },
    /** A signed inbound text from a number, through the real inbound route. */
    async text(routes: Routes, from: string, body: string, extra: { id?: string; media?: Array<{ url: string; contentType: string }>; signature?: string | null } = {}) {
      return routes.inbound.POST(provider.inboundRequest({ id: extra.id ?? `IN${++counter}-${randomUUID().slice(0, 8)}`, from, body, media: extra.media, signature: extra.signature }));
    },
    /** What Commons has sent, in order. */
    sent: () => provider.outbox.map(item => item.body),
    last: () => provider.outbox.at(-1)?.body ?? "",
    async enroll(routes: Routes, who: "maya" | "sam" | "casey", trip: "sonoma" | "tahoe", phone = phones[who]) {
      actAs(ids[who]);
      return routes.enrollment.POST(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone, consent: true }) }), { params: Promise.resolve({ slug: slugs[trip] }) });
    },
    async attendance(who: "maya" | "sam" | "casey", trip: "sonoma" | "tahoe") {
      return q(async db => (await db.select({ state: memberships.attendanceState }).from(memberships).where(and(eq(memberships.commonsId, ids[trip]), eq(memberships.personId, ids[who]))))[0]?.state);
    },
    async messageRows(phone: string) { return q(db => db.select().from(messagingMessages).where(eq(messagingMessages.phoneHash, phoneHashOf(phone)))); },
    async cleanup() {
      setMessagingDepsForTests(null); setMessagingProviderForTests(undefined);
      const handle = createDatabase(url);
      try {
        const hashes = Object.values(phones).map(phoneHashOf);
        await handle.db.delete(messagingMessages).where(inArray(messagingMessages.phoneHash, hashes));
        await handle.db.delete(messagingWebhookEvents).where(eq(messagingWebhookEvents.provider, "fake"));
        await handle.db.delete(messagingPhones).where(inArray(messagingPhones.phoneHash, hashes));
        await handle.db.delete(commons).where(inArray(commons.id, [ids.sonoma, ids.tahoe]));
        await handle.db.delete(people).where(inArray(people.id, [ids.maya, ids.sam, ids.casey]));
      } finally { await handle.close(); }
    },
    async addStay(trip: "sonoma" | "tahoe", name: string, address: string, personIds: string[]) {
      const stayId = randomUUID();
      await q(async db => {
        await db.insert(stays).values({ id: stayId, commonsId: ids[trip], createdByPersonId: ids.casey, name, address, startsOn: trip === "sonoma" ? "2027-06-11" : "2027-12-03", endsOn: trip === "sonoma" ? "2027-06-13" : "2027-12-05", status: "confirmed", sourceLabel: "Added by Casey Synthetic" });
        await db.insert(stayParticipants).values(personIds.map(personId => ({ stayId, personId })));
      });
      return stayId;
    },
    async travelPlans(trip: "sonoma" | "tahoe") { return q(db => db.select().from(travelPlans).where(eq(travelPlans.commonsId, ids[trip]))); },
  };
  return world;
}

export const json = async (response: Response) => ({ status: response.status, body: await response.json().catch(() => null) as Record<string, any> | null }); // eslint-disable-line @typescript-eslint/no-explicit-any
