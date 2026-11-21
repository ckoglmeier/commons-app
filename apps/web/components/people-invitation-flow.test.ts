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

test("without email set up, adding a traveler reads as normal: a private link to share, not a failure", async () => {
  const base = { commons: pilotSnapshot.commons, currentPersonId: pilotSnapshot.currentActor.id, organizerName: "Synthetic organizer", people: [] as unknown[] };
  const added = (input: { displayName: string; email: string; role: string }) => ({ membershipId: "membership-new", personId: "new-traveler", displayName: input.displayName, email: input.email, role: input.role, membershipStatus: "invited", joinedAt: null, accessMode: "account", managedByPersonIds: null, canClaimAccess: false, removal: { blocked: false, moneyItems: 0, responsibilityItems: 0 }, invitation: { id: "new-invitation", status: "pending", deliveryState: "failed", deliveryErrorCode: "email_not_configured", message: null, sentAt: null, lastAttemptAt: null, expiresAt: null } });
  const posted: Array<Record<string, unknown>> = [];
  const live = installFakeBrowserEnvironment({ fetch: async (_url, init) => {
    if (init?.method !== "POST") return Response.json({ people: base });
    posted.push(JSON.parse(String(init.body)));
    return Response.json({ people: { ...base, people: [added(JSON.parse(String(init.body)))] } });
  } });
  const { PeopleSheet } = await import("./people-sheet");
  const renderer = createHookRenderer({ expand: [PeopleSheet] });
  const text = () => renderer.tree.map(textOf).join(" ");
  try {
    renderer.render(createElement(PeopleSheet, { slug: base.commons.slug, tripName: base.commons.name, tripStatus: "planning", participants: [], currentPersonId: base.currentPersonId, canManage: true, close: () => {}, emailInvitations: false }));
    await settle(10); renderer.flush();
    (renderer.find(node => node.type === "button" && textOf(node).trim() === "Add traveler").props.onClick as () => void)(); renderer.flush();
    assert.match(text(), /Email isn’t set up on this copy, so Commons won’t send an invitation\. Add them, then copy their private link and send it yourself\. They still need to accept; attendance is separate\./);
    assert.doesNotMatch(text(), /sends their invitation email automatically/);
    assert.doesNotMatch(text(), /Invitation message/, "the message only travels in an email, so there is no field for it");
    assert.equal(renderer.findAll(node => node.type === "textarea").length, 0);
    (renderer.find(node => node.type === "input" && node.props.maxLength === 80).props.onChange as (event: unknown) => void)({ target: { value: "Maya Rivera" } });
    (renderer.find(node => node.type === "input" && node.props.type === "email").props.onChange as (event: unknown) => void)({ target: { value: "maya@example.com" } });
    renderer.flush();
    (renderer.find(node => node.type === "form" && node.props.className === "people-form").props.onSubmit as (event: unknown) => void)({ preventDefault() {} });
    await settle(10); renderer.flush();
    assert.match(text(), /Maya Rivera was added\. Copy their private link and send it to them\./);
    assert.equal(posted[0]?.message, null, "no invitation message is sent without email");
    assert.equal(renderer.findAll(node => node.props.role === "alert").length, 0);
    assert.doesNotMatch(text(), /Email isn’t set up yet|could not be sent|Retry invitation/);
    const counts = renderer.find(node => node.props["aria-label"] === "Traveler status");
    assert.match(textOf(counts), /1\s*Invited/);
    assert.match(textOf(counts), /0\s*Needs attention/);
    assert.equal(renderer.findAll(node => node.type === "article" && String(node.props.className).includes("people-row--attention")).length, 0);
    const status = renderer.find(node => node.type === "span" && String(node.props.className).startsWith("people-status "));
    assert.equal(textOf(status), "Not sent");
    assert.match(String(status.props.className), /people-status--not_sent/);
    assert.match(text(), /Copy their private link and send it yourself\./);
    (renderer.find(node => node.type === "button" && node.props.className === "people-row__summary").props.onClick as () => void)(); renderer.flush();
    const actions = renderer.find(node => node.props.className === "people-row__actions");
    assert.doesNotMatch(textOf(actions), /Resend email|Send email|Send invitation|Retry invitation/);
    assert.match(textOf(actions).trim(), /^Copy private link/);
  } finally { renderer.unmount(); live.restore(); }
});

test("with email set up, a failed invitation still needs attention and offers a retry", async () => {
  const base = { commons: pilotSnapshot.commons, currentPersonId: pilotSnapshot.currentActor.id, organizerName: "Synthetic organizer", people: [{ membershipId: "membership-sam", personId: "sam", displayName: "Sam Lee", email: "sam@example.com", role: "member", membershipStatus: "invited", joinedAt: null, accessMode: "account", managedByPersonIds: null, canClaimAccess: false, removal: { blocked: false, moneyItems: 0, responsibilityItems: 0 }, invitation: { id: "sam-invitation", status: "pending", deliveryState: "failed", deliveryErrorCode: "email_not_configured", message: null, sentAt: null, lastAttemptAt: null, expiresAt: null } }] as unknown[] };
  const live = installFakeBrowserEnvironment({ fetch: async () => Response.json({ people: base }) });
  const { PeopleSheet } = await import("./people-sheet");
  const renderer = createHookRenderer({ expand: [PeopleSheet] });
  try {
    renderer.render(createElement(PeopleSheet, { slug: base.commons.slug, tripName: base.commons.name, tripStatus: "planning", participants: [], currentPersonId: base.currentPersonId, canManage: true, close: () => {} }));
    await settle(10); renderer.flush();
    assert.match(textOf(renderer.find(node => node.props["aria-label"] === "Traveler status")), /1\s*Needs attention/);
    assert.match(renderer.tree.map(textOf).join(" "), /Email isn’t set up yet\. Copy the private link instead\./);
    (renderer.find(node => node.type === "button" && node.props.className === "people-row__summary").props.onClick as () => void)(); renderer.flush();
    assert.match(textOf(renderer.find(node => node.props.className === "people-row__actions")), /^Retry invitation/);
  } finally { renderer.unmount(); live.restore(); }
});

for (const delivery of [{ deliveryState: "sent", deliveryErrorCode: null, stale: /Waiting for them to join/ }, { deliveryState: "failed", deliveryErrorCode: null, stale: /Email wasn’t delivered/ }] as const) {
  test(`a traveler who has joined does not show stale ${delivery.deliveryState} invitation help`, async () => {
    const base = { commons: pilotSnapshot.commons, currentPersonId: pilotSnapshot.currentActor.id, organizerName: "Synthetic organizer", people: [{ membershipId: "membership-sam", personId: "sam", displayName: "Sam Lee", email: "sam@example.com", role: "member", membershipStatus: "active", joinedAt: "2026-11-01T00:00:00.000Z", accessMode: "account", managedByPersonIds: null, canClaimAccess: false, removal: { blocked: false, moneyItems: 0, responsibilityItems: 0 }, invitation: { id: "sam-invitation", status: "accepted", deliveryState: delivery.deliveryState, deliveryErrorCode: delivery.deliveryErrorCode, message: null, sentAt: null, lastAttemptAt: null, expiresAt: null } }] as unknown[] };
    const live = installFakeBrowserEnvironment({ fetch: async () => Response.json({ people: base }) });
    const { PeopleSheet } = await import("./people-sheet");
    const renderer = createHookRenderer({ expand: [PeopleSheet] });
    try {
      renderer.render(createElement(PeopleSheet, { slug: base.commons.slug, tripName: base.commons.name, tripStatus: "planning", participants: [], currentPersonId: base.currentPersonId, canManage: true, close: () => {} }));
      await settle(10); renderer.flush();
      const text = renderer.tree.map(textOf).join(" ");
      assert.match(text, /Sam Lee/);
      assert.match(text, /Joined/);
      assert.doesNotMatch(text, delivery.stale);
    } finally { renderer.unmount(); live.restore(); }
  });
}

test("when the browser refuses the clipboard, the private link stays on screen to copy by hand", async () => {
  const invitation = { id: "invitation-sam", status: "pending", deliveryState: "not_sent", deliveryErrorCode: null, message: null, sentAt: null, lastAttemptAt: null, expiresAt: null };
  const sam = { membershipId: "membership-sam", personId: "sam", displayName: "Sam Lee", email: "sam@example.com", role: "member", membershipStatus: "invited", joinedAt: null, accessMode: "account", managedByPersonIds: null, canClaimAccess: false, removal: { blocked: false, moneyItems: 0, responsibilityItems: 0 }, invitation };
  const base = { commons: pilotSnapshot.commons, currentPersonId: pilotSnapshot.currentActor.id, organizerName: "Synthetic organizer", people: [sam] };
  const link = (url: string) => ({ link: { invitationId: invitation.id, url, expiresAt: null } });
  const live = installFakeBrowserEnvironment({ fetch: async (url, init) => {
    if (url.endsWith(`/invitations/${invitation.id}/link`)) return Response.json(link(init?.method === "POST" ? "https://trips.example.com/join/new-token" : "https://trips.example.com/join/first-token"));
    return Response.json({ people: base });
  } });
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new DOMException("Write permission denied.", "NotAllowedError"); } } });
  const { PeopleSheet } = await import("./people-sheet");
  const renderer = createHookRenderer({ expand: [PeopleSheet] });
  const text = () => renderer.tree.map(textOf).join(" ");
  const click = (label: string) => (renderer.find(node => node.type === "button" && textOf(node).trim() === label).props.onClick as () => void)();
  const field = () => renderer.findAll(node => node.type === "input" && node.props.readOnly === true);
  try {
    renderer.render(createElement(PeopleSheet, { slug: base.commons.slug, tripName: base.commons.name, tripStatus: "planning", participants: [], currentPersonId: base.currentPersonId, canManage: true, close: () => {}, emailInvitations: false }));
    await settle(10); renderer.flush();
    (renderer.find(node => node.type === "button" && node.props.className === "people-row__summary").props.onClick as () => void)(); renderer.flush();
    click("Copy private link"); await settle(10); renderer.flush();
    assert.match(text(), /Couldn’t copy automatically\. Select and copy the link below\./);
    assert.doesNotMatch(text(), /Private link unavailable|Write permission denied/);
    assert.equal(field()[0]?.props.value, "https://trips.example.com/join/first-token");
    assert.match(text(), /Private link/);
    assert.equal(typeof field()[0]?.props.onFocus, "function", "focusing the field selects the link");
    click("Replace link"); await settle(10); renderer.flush();
    assert.match(text(), /Link replaced\. Couldn’t copy automatically\. Select and copy the new link below\./);
    assert.equal(field().length, 1);
    assert.equal(field()[0]?.props.value, "https://trips.example.com/join/new-token");
    (renderer.find(node => node.type === "button" && node.props.className === "people-row__summary").props.onClick as () => void)(); renderer.flush();
    assert.equal(field().length, 0, "closing the row clears the link");
  } finally { renderer.unmount(); live.restore(); delete (navigator as unknown as Record<string, unknown>).clipboard; }
});

test("copying a private link says how long it works", async () => {
  const invitation = { id: "invitation-riley", status: "pending", deliveryState: "not_sent", deliveryErrorCode: null, message: null, sentAt: null, lastAttemptAt: null, expiresAt: "2026-12-20T15:00:00.000Z" };
  const riley = { membershipId: "membership-riley", personId: "riley", displayName: "Riley Park", email: "riley@example.com", role: "member", membershipStatus: "invited", joinedAt: null, accessMode: "account", managedByPersonIds: null, canClaimAccess: false, removal: { blocked: false, moneyItems: 0, responsibilityItems: 0 }, invitation };
  const base = { commons: pilotSnapshot.commons, currentPersonId: pilotSnapshot.currentActor.id, organizerName: "Synthetic organizer", people: [riley] };
  const live = installFakeBrowserEnvironment({ fetch: async (url, init) => {
    if (url.endsWith(`/invitations/${invitation.id}/link`)) return Response.json({ link: { invitationId: invitation.id, url: "https://trips.example.com/join/riley-token", expiresAt: init?.method === "POST" ? "2027-01-05T15:00:00.000Z" : invitation.expiresAt } });
    return Response.json({ people: base });
  } });
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => {} } });
  const { PeopleSheet } = await import("./people-sheet");
  const renderer = createHookRenderer({ expand: [PeopleSheet] });
  const text = () => renderer.tree.map(textOf).join(" ");
  const click = (label: string) => (renderer.find(node => node.type === "button" && textOf(node).trim() === label).props.onClick as () => void)();
  try {
    renderer.render(createElement(PeopleSheet, { slug: base.commons.slug, tripName: base.commons.name, tripStatus: "planning", participants: [], currentPersonId: base.currentPersonId, canManage: true, close: () => {}, emailInvitations: false }));
    await settle(10); renderer.flush();
    (renderer.find(node => node.type === "button" && node.props.className === "people-row__summary").props.onClick as () => void)(); renderer.flush();
    click("Copy private link"); await settle(10); renderer.flush();
    assert.match(text(), /Private link copied\. It works until Dec 20, 2026\./);
    click("Replace link"); await settle(10); renderer.flush();
    assert.match(text(), /New private link copied\. The old link no longer works\. It works until Jan 5, 2027\./);
  } finally { renderer.unmount(); live.restore(); delete (navigator as unknown as Record<string, unknown>).clipboard; }
});

test("an expired private link reads Expired and offers Replace link first", async () => {
  const invitation = { id: "invitation-casey", status: "expired", deliveryState: "not_sent", deliveryErrorCode: null, message: null, sentAt: null, lastAttemptAt: null, expiresAt: "2026-11-01T00:00:00.000Z" };
  const casey = { membershipId: "membership-casey", personId: "casey", displayName: "Casey Moreno", email: "casey@example.com", role: "member", membershipStatus: "invited", joinedAt: null, accessMode: "account", managedByPersonIds: null, canClaimAccess: false, removal: { blocked: false, moneyItems: 0, responsibilityItems: 0 }, invitation };
  const base = { commons: pilotSnapshot.commons, currentPersonId: pilotSnapshot.currentActor.id, organizerName: "Synthetic organizer", people: [casey] };
  const live = installFakeBrowserEnvironment({ fetch: async () => Response.json({ people: base }) });
  const { PeopleSheet } = await import("./people-sheet");
  const renderer = createHookRenderer({ expand: [PeopleSheet] });
  const text = () => renderer.tree.map(textOf).join(" ");
  try {
    renderer.render(createElement(PeopleSheet, { slug: base.commons.slug, tripName: base.commons.name, tripStatus: "planning", participants: [], currentPersonId: base.currentPersonId, canManage: true, close: () => {}, emailInvitations: false }));
    await settle(10); renderer.flush();
    const status = renderer.find(node => node.type === "span" && String(node.props.className).startsWith("people-status "));
    assert.equal(textOf(status), "Expired");
    assert.match(text(), /Replace the link and send the new one\./);
    assert.doesNotMatch(text(), /legacy/i);
    assert.match(textOf(renderer.find(node => node.props["aria-label"] === "Traveler status")), /1\s*Needs attention/);
    (renderer.find(node => node.type === "button" && node.props.className === "people-row__summary").props.onClick as () => void)(); renderer.flush();
    const note = renderer.find(node => node.props.className === "member-removal-note");
    const buttons = renderer.findAll(node => node.type === "button" && node.props.className === "sheet-secondary").map(node => textOf(node).trim());
    assert.match(textOf(note), /^Expired/);
    assert.deepEqual(buttons.slice(0, 2), ["Replace link", "Copy private link"]);
  } finally { renderer.unmount(); live.restore(); }
});
