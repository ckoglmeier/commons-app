import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { pilotSnapshot } from "../lib/pilot-fixture";
import { createHookRenderer, registerComponentImportStubs, textOf } from "../lib/test-support/hook-harness";
import { installFakeBrowserEnvironment, settle } from "../lib/test-support/fake-browser-environment";
registerComponentImportStubs();

for (const state of ["sent", "queued", "failed", "not_sent"] as const) {
  test(`traveler add reports the saved ${state} result without a separate send request`, async () => {
    const requests: string[] = [];
    const base = { commons: pilotSnapshot.commons, currentPersonId: pilotSnapshot.currentActor.id, organizerName: "Synthetic organizer", people: [] as unknown[] };
    const live = installFakeBrowserEnvironment({ fetch: async (url, init) => {
      if (init?.method !== "POST") return Response.json({ people: base });
      requests.push(url);
      const input = JSON.parse(String(init.body));
      return Response.json({ people: { ...base, people: [{ membershipId: "membership-new", personId: "new-traveler", displayName: input.displayName, email: input.email, role: input.role, membershipStatus: "invited", joinedAt: null, accessMode: "account", managedByPersonIds: null, canClaimAccess: false, removal: { blocked: false, moneyItems: 0, responsibilityItems: 0 }, invitation: { id: "new-invitation", status: "pending", deliveryState: state, deliveryErrorCode: state === "failed" ? "provider_unavailable" : null, message: null, sentAt: null, lastAttemptAt: null, expiresAt: null } }] } });
    } });
    const { PeopleSheet } = await import("./people-sheet");
    const renderer = createHookRenderer({ expand: [PeopleSheet] });
    const text = () => renderer.tree.map(textOf).join(" ");
    try {
      renderer.render(createElement(PeopleSheet, { slug: base.commons.slug, tripName: base.commons.name, tripStatus: "planning", participants: [], currentPersonId: base.currentPersonId, canManage: true, close: () => {} }));
      await settle(10); renderer.flush();
      (renderer.find(node => node.type === "button" && textOf(node).trim() === "Add traveler").props.onClick as () => void)(); renderer.flush();
      assert.match(text(), /Inviting this traveler sends their invitation email automatically/);
      (renderer.find(node => node.type === "input" && node.props.maxLength === 80).props.onChange as (event: unknown) => void)({ target: { value: "New traveler" } });
      (renderer.find(node => node.type === "input" && node.props.type === "email").props.onChange as (event: unknown) => void)({ target: { value: "new@example.com" } });
      renderer.flush();
      assert.equal(textOf(renderer.find(node => node.type === "button" && node.props.type === "submit")), "Invite traveler");
      (renderer.find(node => node.type === "form" && node.props.className === "people-form").props.onSubmit as (event: unknown) => void)({ preventDefault() {} });
      await settle(10); renderer.flush();
      assert.deepEqual(requests, [`/api/v1/commons/${base.commons.slug}/people`]);
      if (state === "sent") assert.match(text(), /Invitation email sent/);
      else if (state === "queued") assert.match(text(), /Invitation email queued/);
      else {
        assert.doesNotMatch(text(), /Invitation email sent|Invitation email queued/);
        assert.match(text(), state === "failed" ? /could not be sent.*Retry invitation/ : /was not sent.*Send invitation/);
      }
    } finally { renderer.unmount(); live.restore(); }
  });
}

test("organizer entry explains the separate send and does not claim queued delivery", async () => {
  const base = { commons: pilotSnapshot.commons, currentPersonId: pilotSnapshot.currentActor.id, organizerName: "Synthetic organizer", people: [] as unknown[] };
  const live = installFakeBrowserEnvironment({ fetch: async (_url, init) => {
    if (init?.method !== "POST") return Response.json({ people: base });
    const input = JSON.parse(String(init.body));
    return Response.json({ people: { ...base, people: [{ membershipId: "membership-new", personId: "new-organizer", displayName: input.displayName, email: input.email, role: "organizer", membershipStatus: "invited", joinedAt: null, accessMode: "account", managedByPersonIds: null, canClaimAccess: false, removal: { blocked: false, moneyItems: 0, responsibilityItems: 0 }, invitation: { id: "new-invitation", status: "pending", deliveryState: "not_sent", deliveryErrorCode: null, message: null, sentAt: null, lastAttemptAt: null, expiresAt: null } }] } });
  } });
  const { PeopleSheet } = await import("./people-sheet");
  const renderer = createHookRenderer({ expand: [PeopleSheet] });
  try {
    renderer.render(createElement(PeopleSheet, { slug: base.commons.slug, tripName: base.commons.name, tripStatus: "planning", participants: [], currentPersonId: base.currentPersonId, canManage: true, close: () => {} }));
    await settle(10); renderer.flush();
    (renderer.find(node => node.type === "button" && textOf(node).trim() === "Add traveler").props.onClick as () => void)(); renderer.flush();
    (renderer.find(node => node.type === "select" && node.props["aria-label"] === "Trip role").props.onChange as (event: unknown) => void)({ target: { value: "organizer" } });
    (renderer.find(node => node.type === "input" && node.props.maxLength === 80).props.onChange as (event: unknown) => void)({ target: { value: "New organizer" } });
    (renderer.find(node => node.type === "input" && node.props.type === "email").props.onChange as (event: unknown) => void)({ target: { value: "organizer@example.com" } });
    renderer.flush();
    assert.equal(textOf(renderer.find(node => node.type === "button" && node.props.type === "submit")), "Prepare organizer invitation");
    assert.match(renderer.tree.map(textOf).join(" "), /Send it separately/);
    (renderer.find(node => node.type === "form" && node.props.className === "people-form").props.onSubmit as (event: unknown) => void)({ preventDefault() {} });
    await settle(10); renderer.flush();
    assert.match(renderer.tree.map(textOf).join(" "), /organizer invitation is ready. No email sent yet/);
    assert.doesNotMatch(renderer.tree.map(textOf).join(" "), /Invitation email queued/);
  } finally { renderer.unmount(); live.restore(); }
});
