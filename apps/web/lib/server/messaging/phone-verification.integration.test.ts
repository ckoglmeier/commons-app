import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { identities, messagingConsents, messagingMessages, messagingPhoneVerifications, phoneHashOf, startPhoneVerification } from "@commons/database";
import { actAs, json, loadRoutes, skip, testDatabaseUrl, world } from "./test-world";
import { normalizePhone } from "../../contact-methods";
import { ProviderSendError } from "./provider";

/* Synthetic evidence: the fake provider, a disposable database and invented numbers. No message leaves the process. */
const contact = () => import("../../../app/api/v1/profile/contact/route");
const send = async (value: string) => { const { POST } = await contact(); return json(await POST(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "phone", value }) }))); };
const confirm = async (value: string, code: string) => { const { PUT } = await contact(); return json(await PUT(new Request("http://localhost/x", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ value, code }) }))); };
const lastCode = (w: { last(): string }) => /code is (\d{6})/.exec(w.last())?.[1] ?? "";
const newPhone = () => `+1415666${String(Math.floor(1000 + Math.random() * 8999))}`;
function available() {
  process.env.COMMONS_SMS_PROVIDER = "twilio"; process.env.COMMONS_SMS_SEND_MODE = "live";
  return () => { delete process.env.COMMONS_SMS_PROVIDER; delete process.env.COMMONS_SMS_SEND_MODE; };
}

test("people type numbers the way they say them", () => {
  assert.equal(normalizePhone("(415) 555-0123"), "+14155550123");
  assert.equal(normalizePhone("1 415 555 0123"), "+14155550123");
  assert.equal(normalizePhone("+44 20 7946 0958"), "+442079460958");
  assert.equal(normalizePhone("555-0123"), null);
  assert.equal(normalizePhone("+0123456789"), null);
});

test("until texts can be sent, a phone request is refused and nothing is stored or sent", { skip }, async () => {
  const w = await world();
  try {
    actAs(w.ids.maya);
    delete process.env.COMMONS_SMS_PROVIDER;
    const before = (await w.q(db => db.select().from(messagingPhoneVerifications).where(eq(messagingPhoneVerifications.personId, w.ids.maya)))).length;
    assert.equal((await send(newPhone())).status, 503);
    assert.equal((await confirm(newPhone(), "123456")).status, 503);
    assert.equal(w.provider.outbox.length, 0);
    assert.equal((await w.q(db => db.select().from(messagingPhoneVerifications).where(eq(messagingPhoneVerifications.personId, w.ids.maya)))).length, before);
  } finally { await w.cleanup(); }
});

test("a code proves the number, grants no consent, and is never stored readable", { skip }, async () => {
  const restore = available(); const w = await world(); const phone = newPhone();
  process.env.COMMONS_SMS_PROVIDER = "twilio";
  try {
    actAs(w.ids.maya);
    const sent = await send(phone);
    assert.equal(sent.status, 200); assert.equal(sent.body?.status, "code_sent");
    const code = lastCode(w); assert.match(code, /^\d{6}$/);
    // Not verified yet: enrollment still refuses this number.
    const routes = await loadRoutes();
    assert.equal((await json(await w.enroll(routes, "maya", "sonoma", phone))).status, 409);

    const stored = await w.q(db => db.select().from(messagingPhoneVerifications).where(eq(messagingPhoneVerifications.phoneHash, phoneHashOf(phone))));
    assert.equal(stored.length, 1); assert.ok(!stored[0]!.codeHash.includes(code));
    const rows = await w.q(db => db.select().from(messagingMessages).where(eq(messagingMessages.phoneHash, phoneHashOf(phone))));
    assert.equal(rows.length, 1); assert.ok(!rows[0]!.body.includes(code), "the code isn't kept in the message record"); assert.equal(rows[0]!.status, "sent");

    const confirmed = await confirm("(" + phone.slice(2, 5) + ") " + phone.slice(5, 8) + "-" + phone.slice(8), code);
    assert.equal(confirmed.status, 200); assert.equal(confirmed.body?.phone, phone);
    assert.equal((await w.q(db => db.select().from(messagingConsents).where(eq(messagingConsents.personId, w.ids.maya)))).length, 0, "verifying grants no consent");
    // A code works once.
    assert.equal((await confirm(phone, code)).status, 410);
    // Now enrollment works without the browser supplying the number.
    actAs(w.ids.maya);
    const enrolled = await routes.enrollment.POST(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ consent: true }) }), { params: Promise.resolve({ slug: w.slugs.sonoma }) });
    assert.equal(enrolled.status, 200);
    assert.ok(w.provider.outbox.some(item => item.to === phone && /this is Commons/.test(item.body)), "the welcome goes to the verified number");
  } finally {
    restore();
    await w.q(db => db.delete(messagingMessages).where(eq(messagingMessages.phoneHash, phoneHashOf(phone))));
    await w.cleanup();
  }
});

test("wrong codes are counted and stop working, and limits hold however often someone asks", { skip }, async () => {
  const restore = available(); const w = await world(); process.env.COMMONS_SMS_PROVIDER = "twilio";
  const phones = [newPhone(), newPhone()];
  try {
    actAs(w.ids.sam);
    assert.equal((await send(phones[0]!)).status, 200);
    const code = lastCode(w), wrong = code === "000000" ? "111111" : "000000";
    for (let attempt = 1; attempt < 5; attempt++) assert.equal((await confirm(phones[0]!, wrong)).body?.code, "invalid_code");
    assert.equal((await confirm(phones[0]!, wrong)).body?.code, "too_many_attempts");
    assert.equal((await confirm(phones[0]!, code)).body?.code, "too_many_attempts", "the right code no longer works after too many tries");
    assert.equal((await confirm(phones[0]!, "not a code")).body?.code, "too_many_attempts");

    // Three codes an hour per number.
    assert.equal((await send(phones[0]!)).status, 200);
    assert.equal((await send(phones[0]!)).status, 200);
    assert.equal((await send(phones[0]!)).body?.code, "rate_limited");
    // Five an hour per person, across numbers.
    assert.equal((await send(phones[1]!)).status, 200);
    assert.equal((await send(phones[1]!)).status, 200);
    assert.equal((await send(phones[1]!)).body?.code, "rate_limited");
    const outbound = w.provider.outbox.length;
    assert.equal(outbound, 5, "a refused request sends nothing");
    // A later hour opens up again.
    w.clock.advance(3_700_000);
    assert.equal((await send(phones[1]!)).status, 200);
    // An earlier code stops working once a newer one is sent.
    const latest = lastCode(w);
    assert.equal((await send(phones[1]!)).status, 200);
    if (latest !== lastCode(w)) assert.equal((await confirm(phones[1]!, latest)).body?.code, "invalid_code");
  } finally {
    restore();
    for (const phone of phones) await w.q(db => db.delete(messagingMessages).where(eq(messagingMessages.phoneHash, phoneHashOf(phone))));
    await w.cleanup();
  }
});

test("a number on someone else's account can't be taken, and the answer only comes after proving control", { skip }, async () => {
  const restore = available(); const w = await world(); process.env.COMMONS_SMS_PROVIDER = "twilio";
  try {
    actAs(w.ids.sam);
    assert.equal((await send(w.phones.maya)).status, 200, "asking for a code doesn't reveal the number is taken");
    const taken = await confirm(w.phones.maya, lastCode(w));
    assert.equal(taken.status, 409); assert.equal(taken.body?.code, "number_taken");
    const owner = await w.q(db => db.select().from(identities).where(eq(identities.normalizedHash, phoneHashOf(w.phones.maya))));
    assert.equal(owner[0]!.personId, w.ids.maya, "the owner keeps the number");
  } finally { restore(); await w.cleanup(); }
});

test("changing number stops everything on the old one, and nothing carries over without a new yes", { skip }, async () => {
  const restore = available(); const w = await world(); process.env.COMMONS_SMS_PROVIDER = "twilio"; const phone = newPhone();
  try {
    const routes = await loadRoutes();
    assert.equal((await w.enroll(routes, "maya", "sonoma")).status, 200);
    actAs(w.ids.maya);
    await send(phone);
    assert.equal((await confirm(phone, lastCode(w))).status, 200);
    const consents = await w.q(db => db.select().from(messagingConsents).where(eq(messagingConsents.personId, w.ids.maya)));
    assert.ok(consents.length > 0 && consents.every(consent => consent.status === "revoked" && consent.revokedReason === "number_changed"));
    const before = w.provider.outbox.length;
    await w.text(routes, w.phones.maya, "yes");
    assert.ok(!w.provider.outbox.slice(before).some(item => /Sonoma/.test(item.body)), "the old number reaches no trip details");
    const page = await routes.enrollment.GET(new Request("http://localhost/x"), { params: Promise.resolve({ slug: w.slugs.sonoma }) });
    assert.equal((await json(page)).body?.enrolled, false, "the new number isn't enrolled until the person says so");
  } finally {
    restore();
    await w.q(db => db.delete(messagingMessages).where(eq(messagingMessages.phoneHash, phoneHashOf(phone))));
    await w.cleanup();
  }
});

test("an opted-out number gets no code, and a provider failure leaves nothing redeemable", { skip }, async () => {
  const restore = available(); const w = await world(); process.env.COMMONS_SMS_PROVIDER = "twilio"; const phone = newPhone();
  try {
    const routes = await loadRoutes();
    await w.text(routes, phone, "STOP");
    actAs(w.ids.sam);
    const before = w.provider.outbox.length;
    assert.equal((await send(phone)).body?.code, "opted_out");
    assert.equal(w.provider.outbox.length, before);

    const fresh = newPhone();
    w.provider.failNext(new ProviderSendError("rejected", "http_400", false));
    const failed = await send(fresh);
    assert.equal(failed.status, 502); assert.equal(failed.body?.code, "send_failed");
    assert.equal((await confirm(fresh, "123456")).status, 410, "a code that never went out can't be redeemed");
  } finally {
    restore();
    await w.q(db => db.delete(messagingMessages).where(eq(messagingMessages.phoneHash, phoneHashOf(phone))));
    await w.cleanup();
  }
});

test("the repository refuses a malformed number before storing anything", { skip }, async () => {
  const result = await startPhoneVerification({ personId: "00000000-0000-4000-8000-000000000000", phone: "not a number" }, { databaseUrl: testDatabaseUrl() });
  assert.deepEqual(result, { ok: false, reason: "invalid_number" });
});
