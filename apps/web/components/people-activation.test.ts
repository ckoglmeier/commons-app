import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { pilotSnapshot } from "../lib/pilot-fixture";
import { createHookRenderer, registerComponentImportStubs, textOf } from "../lib/test-support/hook-harness";
import { installFakeLiveEnvironment, settle } from "../lib/test-support/fake-live-transport";
registerComponentImportStubs();

for (const state of ["exempt", "payment_required", "allowed", "approval_revoked", "refund_hold", "failure"] as const) {
  test(`People retains roster and archive while ${state} cannot bypass activation`, async () => {
    const mutations: string[] = [];
    const people = { commons: pilotSnapshot.commons, currentPersonId: pilotSnapshot.currentActor.id, organizerName: "Synthetic organizer", people: [{
      membershipId: "membership-pending", personId: "pending", displayName: "Pending traveler", email: "pending@example.test", role: "member", membershipStatus: "invited", joinedAt: null, accessMode: "account", managedByPersonIds: null, canClaimAccess: false,
      removal: { blocked: false, moneyItems: 0, responsibilityItems: 0 }, invitation: { id: "invitation-pending", status: "pending", deliveryState: "not_sent", deliveryErrorCode: null, message: null, sentAt: null, lastAttemptAt: null, expiresAt: null },
    }] };
    const live = installFakeLiveEnvironment({ liveFetch: async (url, init) => {
      if (init?.method === "POST") mutations.push(url);
      if (url.includes("trip-activation/status")) return state === "failure" ? new Response("", { status: 503 }) : Response.json({ status: { state, required: state !== "exempt", mayInvite: ["allowed", "exempt"].includes(state), draftId: "draft", feeCents: state === "exempt" ? 0 : 2000, savedPeople: [], unsentInvitees: [], reconciliationNeeded: false } });
      return Response.json({ people });
    } });
    const { PeopleSheet } = await import("./people-sheet");
    const { FirstInviteNotice } = await import("./first-invite-notice");
    const { GoingAction } = await import("./trip-stage-gate");
    const renderer = createHookRenderer({ expand: [PeopleSheet, FirstInviteNotice, GoingAction] });
    const text = () => renderer.tree.map(textOf).join(" ");
    try {
      renderer.render(createElement(PeopleSheet, { slug: "trip", tripName: "Coast", tripStatus: "planning", participants: [], currentPersonId: people.currentPersonId, canManage: true, close: () => {}, activationEnabled: true, decidingStage: true }));
      assert.doesNotMatch(text(), /Add traveler|Share an invite link/);
      await settle(10); renderer.flush();
      assert.match(text(), /Pending traveler/);
      assert.match(text(), /Archive this trip when the group is done/);
      assert.doesNotMatch(text(), /Add traveler|Share an invite link/);
      (renderer.find(node => node.type === "button" && node.props.className === "people-row__summary").props.onClick as () => void)(); renderer.flush();
      assert.doesNotMatch(text(), /Copy private link|Send invitation|Replace link/);
      assert.match(text(), /Revoke invitation/, "revocation remains available");
      if (state === "exempt" || state === "allowed") {
        assert.match(text(), /We’re going — invite people/);
        assert.doesNotMatch(text(), /\$20|Upgrade|Unlock this trip/);
      } else if (state === "payment_required") {
        assert.match(text(), /Unlock this trip to invite people/);
        assert.match(text(), /\$20 for the whole trip/);
      } else if (state === "failure") assert.match(text(), /couldn’t check invitations/);
      else assert.doesNotMatch(text(), /We’re going — invite people|Unlock this trip/);
      assert.deepEqual(mutations, [], "opening People or inspecting a row sends nothing");
    } finally { renderer.unmount(); live.restore(); }
  });
}

test("going beta trips regain add-person controls after server permission loads", async () => {
  const live = installFakeLiveEnvironment({ liveFetch: async url => url.includes("trip-activation/status")
    ? Response.json({ status: { required: false, state: "exempt", mayInvite: true, draftId: "draft", feeCents: 0, savedPeople: [], unsentInvitees: [], reconciliationNeeded: false } })
    : Response.json({ people: { commons: pilotSnapshot.commons, currentPersonId: pilotSnapshot.currentActor.id, organizerName: "Organizer", people: [] } }) });
  const { PeopleSheet } = await import("./people-sheet");
  const { FirstInviteNotice } = await import("./first-invite-notice");
  const renderer = createHookRenderer({ expand: [PeopleSheet, FirstInviteNotice] });
  try {
    renderer.render(createElement(PeopleSheet, { slug: "trip", tripName: "Coast", tripStatus: "planning", participants: [], currentPersonId: pilotSnapshot.currentActor.id, canManage: true, close: () => {}, activationEnabled: true, decidingStage: false }));
    assert.doesNotMatch(renderer.tree.map(textOf).join(" "), /Add traveler/);
    await settle(10); renderer.flush();
    assert.match(renderer.tree.map(textOf).join(" "), /Add traveler/);
  } finally { renderer.unmount(); live.restore(); }
});

test("exempt owners still see copied people waiting after going", async () => {
  const actionStates: boolean[] = [];
  const live = installFakeLiveEnvironment({ liveFetch: async () => Response.json({ status: { required: false, state: "exempt", mayInvite: true, draftId: "draft", feeCents: 0, savedPeople: [{ name: "Kit" }], unsentInvitees: ["Sam"], reconciliationNeeded: false } }) });
  const { FirstInviteNotice } = await import("./first-invite-notice");
  const renderer = createHookRenderer({ expand: [FirstInviteNotice] });
  const onMayInvite = () => {};
  const onActionChange = (active: boolean) => { actionStates.push(active); };
  try {
    renderer.render(createElement(FirstInviteNotice, { slug: "trip", onMayInvite, onActionChange }));
    await settle(10); renderer.flush();
    const text = renderer.tree.map(textOf).join(" ");
    assert.match(text, /2 not yet invited/);
    assert.match(text, /Send invitations/);
    assert.doesNotMatch(text, /\$20|Paid|Upgrade/);
    assert.equal(actionStates.at(-1), true);
  } finally { renderer.unmount(); live.restore(); }
});

test("budget activation uses the free going action without map or payment promises", async () => {
  const live = installFakeLiveEnvironment({ liveFetch: async () => Response.json({ upgrade: false, paid: false }) });
  const { BudgetActivationAction, GoingAction } = await import("./trip-stage-gate");
  const renderer = createHookRenderer({ expand: [BudgetActivationAction, GoingAction] });
  try {
    renderer.render(createElement(BudgetActivationAction, { slug: "trip" }));
    await settle(10); renderer.flush();
    const text = renderer.tree.map(textOf).join(" ");
    assert.match(text, /Ready to go\? Track shared expenses, split costs and record repayments/);
    assert.match(text, /We’re going/);
    assert.doesNotMatch(text, /\$20|Upgrade|map/);
  } finally { renderer.unmount(); live.restore(); }
});
