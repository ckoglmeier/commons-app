import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { pilotSnapshot } from "../lib/pilot-fixture";
import { createHookRenderer, registerComponentImportStubs, textOf } from "../lib/test-support/hook-harness";
import { installFakeBrowserEnvironment, settle } from "../lib/test-support/fake-browser-environment";
registerComponentImportStubs();

const people = { commons: pilotSnapshot.commons, currentPersonId: pilotSnapshot.currentActor.id, organizerName: "Synthetic organizer", people: [{
  membershipId: "membership-pending", personId: "pending", displayName: "Pending traveler", email: "pending@example.test", role: "member", membershipStatus: "invited", joinedAt: null, accessMode: "account", managedByPersonIds: null, canClaimAccess: false,
  removal: { blocked: false, moneyItems: 0, responsibilityItems: 0 }, invitation: { id: "invitation-pending", status: "pending", deliveryState: "not_sent", deliveryErrorCode: null, message: null, sentAt: null, lastAttemptAt: null, expiresAt: null },
}] };

test("while a trip is still deciding, People keeps the roster and archive but offers only the organizer's going action", async () => {
  const mutations: string[] = [];
  const live = installFakeBrowserEnvironment({ fetch: async (url, init) => {
    if (init?.method === "POST") mutations.push(url);
    return Response.json({ people });
  } });
  const { PeopleSheet } = await import("./people-sheet");
  const { GoingAction } = await import("./trip-stage-gate");
  const renderer = createHookRenderer({ expand: [PeopleSheet, GoingAction] });
  const text = () => renderer.tree.map(textOf).join(" ");
  try {
    renderer.render(createElement(PeopleSheet, { slug: "trip", tripName: "Coast", tripStatus: "planning", participants: [], currentPersonId: people.currentPersonId, canManage: true, close: () => {}, decidingStage: true }));
    await settle(10); renderer.flush();
    assert.match(text(), /Pending traveler/);
    assert.match(text(), /Archive this trip when the group is done/);
    assert.match(text(), /We’re going — invite people/);
    assert.doesNotMatch(text(), /Add traveler|Share an invite link|\$20|Upgrade|Unlock this trip/);
    (renderer.find(node => node.type === "button" && node.props.className === "people-row__summary").props.onClick as () => void)(); renderer.flush();
    assert.doesNotMatch(text(), /Copy private link|Send invitation|Replace link/);
    assert.match(text(), /Revoke invitation/, "revocation remains available");
    assert.deepEqual(mutations, [], "opening People or inspecting a row sends nothing");
  } finally { renderer.unmount(); live.restore(); }
});

test("once a trip is going, People offers adding travelers with no fee or gate", async () => {
  const live = installFakeBrowserEnvironment({ fetch: async () => Response.json({ people }) });
  const { PeopleSheet } = await import("./people-sheet");
  const renderer = createHookRenderer({ expand: [PeopleSheet] });
  try {
    renderer.render(createElement(PeopleSheet, { slug: "trip", tripName: "Coast", tripStatus: "planning", participants: [], currentPersonId: pilotSnapshot.currentActor.id, canManage: true, close: () => {}, decidingStage: false }));
    await settle(10); renderer.flush();
    const text = renderer.tree.map(textOf).join(" ");
    assert.match(text, /Add traveler/);
    assert.doesNotMatch(text, /We’re going — invite people|\$20|Upgrade/);
  } finally { renderer.unmount(); live.restore(); }
});

test("the going action is free: it says the trip is going and nothing else", async () => {
  const live = installFakeBrowserEnvironment({ fetch: async () => Response.json({}) });
  const { GoingAction } = await import("./trip-stage-gate");
  const renderer = createHookRenderer({ expand: [GoingAction] });
  try {
    renderer.render(createElement(GoingAction, { slug: "trip", lead: "Ready to go? Track shared expenses, split costs and record repayments." }));
    const text = renderer.tree.map(textOf).join(" ");
    assert.match(text, /Ready to go\? Track shared expenses, split costs and record repayments/);
    assert.match(text, /We’re going/);
    assert.doesNotMatch(text, /\$20|Upgrade|checkout/i);
  } finally { renderer.unmount(); live.restore(); }
});
