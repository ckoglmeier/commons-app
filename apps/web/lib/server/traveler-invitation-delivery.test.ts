import assert from "node:assert/strict";
import test from "node:test";
import { autoSendTravelerInvitation } from "./traveler-invitation-delivery";

test("drains only the new traveler attempt reserved by the add/invite transaction", async () => {
  let calls = 0;
  await autoSendTravelerInvitation({ role: "member", invitation: { status: "pending", deliveryState: "queued" } }, "new-attempt", async () => { calls++; });
  assert.equal(calls, 1);
});

test("does not send organizers, managed profiles without invites, or historical delivery states", async () => {
  const send = async () => { assert.fail("unexpected email"); };
  await autoSendTravelerInvitation(undefined, "new-attempt", send);
  await autoSendTravelerInvitation({ role: "member", invitation: null }, "new-attempt", send);
  await autoSendTravelerInvitation({ role: "organizer", invitation: { status: "pending", deliveryState: "queued" } }, "new-attempt", send);
  await autoSendTravelerInvitation({ role: "member", invitation: { status: "pending", deliveryState: "queued" } }, null, send);
  for (const state of ["not_sent", "sent", "failed"]) {
    await autoSendTravelerInvitation({ role: "member", invitation: { status: "pending", deliveryState: state } }, "new-attempt", send);
  }
  for (const status of ["accepted", "revoked", "expired"]) {
    await autoSendTravelerInvitation({ role: "member", invitation: { status, deliveryState: "queued" } }, "new-attempt", send);
  }
});

test("delivery failure stays observable instead of being reported as sent", async () => {
  await assert.rejects(autoSendTravelerInvitation({ role: "member", invitation: { status: "pending", deliveryState: "queued" } }, "new-attempt", async () => { throw new Error("provider unavailable"); }), /provider unavailable/);
});
