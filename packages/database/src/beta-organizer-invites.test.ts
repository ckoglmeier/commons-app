import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { createDatabase } from "./client";
import { betaOrganizerInvites, identities, operatorAuditEvents, people, eventCreationAccess } from "./schema";
import { claimBetaOrganizerInvite, normalizeBetaInviteEmail, prepareBetaOrganizerInvite, revokeBetaOrganizerInvite } from "./beta-organizer-invites";
import { decideEventCreationAccess, getEventCreationAccess } from "./operator-repository";
import { hashNormalizedEmail } from "./tokens";

test("beta email validation normalizes and rejects malformed addresses", () => {
  assert.equal(normalizeBetaInviteEmail(" Test@Example.com "), "test@example.com");
  for (const email of ["", "bad", "a@b", "a@b.com\nBcc:foo@bar.com"]) assert.throws(() => normalizeBetaInviteEmail(email));
});

test("beta grants require the matching claimed identity, dedupe, and never undo revocation", { skip: process.env.COMMONS_RUN_DATABASE_TESTS !== "1" }, async () => {
  const url = process.env.TEST_DATABASE_URL!;
  const db = createDatabase(url);
  const email = `beta-${randomUUID()}@example.com`;
  const ids: string[] = [];
  try {
    const rows = await db.db.insert(people).values([{ displayName: "QA admin", authUserId: randomUUID() }, { displayName: "QA invitee", authUserId: randomUUID() }]).returning();
    ids.push(...rows.map(r => r.id));
    const [admin, person] = rows;
    const invites = await Promise.all([prepareBetaOrganizerInvite(email, admin.id, url, "Welcome aboard"), prepareBetaOrganizerInvite(email.toUpperCase(), admin.id, url, "Welcome aboard")]);
    assert.equal(invites[0].id, invites[1].id);
    assert.equal(invites[0].message, "Welcome aboard");
    assert.equal((await prepareBetaOrganizerInvite(email, admin.id, url, "Changed message")).message, "Welcome aboard");
    await assert.rejects(prepareBetaOrganizerInvite(email, admin.id, url, "x".repeat(2001)));
    assert.equal(await claimBetaOrganizerInvite(person.id, email, url), false);
    await db.db.insert(identities).values({ personId: person.id, kind: "email", normalizedHash: hashNormalizedEmail(email), state: "claimed" });
    assert.equal(await claimBetaOrganizerInvite(admin.id, email, url), false);
    assert.equal(await claimBetaOrganizerInvite(person.id, email, url), true);
    assert.equal((await getEventCreationAccess(person.id, url))?.status, "approved");
    await decideEventCreationAccess({ personId: person.id, actorPersonId: admin.id, status: "revoked" }, url);
    assert.equal(await claimBetaOrganizerInvite(person.id, email, url), false);
    assert.equal((await getEventCreationAccess(person.id, url))?.status, "revoked");
    await revokeBetaOrganizerInvite(invites[0].id, admin.id, url);
    const pending = await prepareBetaOrganizerInvite(`other-${email}`, admin.id, url);
    await revokeBetaOrganizerInvite(pending.id, admin.id, url);
    assert.equal(await claimBetaOrganizerInvite(person.id, pending.email, url), false);
    await assert.rejects(db.db.transaction(async tx => { await tx.execute("SET LOCAL ROLE authenticated"); await tx.select().from(betaOrganizerInvites); }));
  } finally {
    if (ids.length) {
      await db.db.delete(betaOrganizerInvites).where(inArray(betaOrganizerInvites.invitedByPersonId, ids));
      await db.db.delete(operatorAuditEvents).where(inArray(operatorAuditEvents.actorPersonId, ids));
      await db.db.delete(eventCreationAccess).where(inArray(eventCreationAccess.personId, ids));
      await db.db.delete(identities).where(inArray(identities.personId, ids));
      for (const id of ids) await db.db.delete(people).where(eq(people.id, id));
    }
    await db.close();
  }
});
