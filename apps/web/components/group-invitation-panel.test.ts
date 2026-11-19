import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { createHookRenderer, registerComponentImportStubs, textOf } from "@/lib/test-support/hook-harness";
import { installFakeBrowserEnvironment, settle } from "@/lib/test-support/fake-browser-environment";
registerComponentImportStubs();

const invitation = () => ({ id: crypto.randomUUID(), tripId: crypto.randomUUID(), version: 1, state: "active", expiresAt: "2027-01-01T00:00:00Z", createdByName: "Casey", token: `g_${"a".repeat(32)}` });

test("clicking the inline invite link creates only on request, retries once and offers a truthful copy fallback", async () => {
  const requests: Array<Record<string, unknown>> = [], saved = invitation();
  const live = installFakeBrowserEnvironment({ fetch: async (_url, init) => {
    if (init?.method !== "POST") return Response.json({ enabled: true, invitation: null });
    requests.push(JSON.parse(String(init.body)));
    if (requests.length === 1) throw new Error("Synthetic lost response");
    return Response.json({ enabled: true, invitation: saved });
  } });
  Object.assign(window.location, { origin: "http://localhost" });
  Object.assign(navigator, { share: async () => { throw new Error("Must not invoke Share"); }, clipboard: { writeText: async () => { throw new Error("Denied"); } } });
  const { GroupInvitationPanel } = await import("./group-invitation-panel"), renderer = createHookRenderer({ expand: [GroupInvitationPanel] });
  const click = () => { (renderer.find(node => node.type === "button").props.onClick as () => void)(); renderer.flush(); };
  try {
    renderer.render(createElement(GroupInvitationPanel, { slug: "qa" })); await settle(5); renderer.flush();
    assert.equal(requests.length, 0, "opening People creates nothing");
    assert.deepEqual(renderer.findAll(node => node.type === "button").map(textOf), ["Share an invite link"]);
    assert.equal(renderer.find(node => node.type === "button").props.className, "cm-action cm-action--link");
    assert.match(renderer.tree.map(textOf).join(" "), /Anyone with this link can sign in and join as a traveler/);
    assert.equal(renderer.findAll(node => node.type === "input" || node.type === "select").length, 0);
    click(); click(); await settle(5); renderer.flush();
    assert.equal(requests.length, 1, "double clicks do not dispatch twice");
    assert.doesNotMatch(renderer.tree.map(textOf).join(" "), /Copied/);
    click(); await settle(5); renderer.flush();
    assert.equal(requests[0].commandId, requests[1].commandId);
    assert.equal(requests[1].action, "create"); assert.equal(requests[1].scopeAccepted, true); assert.equal(requests[1].expiresInDays, 14);
    assert.match(renderer.tree.map(textOf).join(" "), /Select and copy the link below/);
    assert.equal(renderer.find(node => node.type === "input" && node.props.readOnly === true).props.value, `http://localhost/group-join/${saved.token}/`);
    Object.assign(navigator, { clipboard: { writeText: async () => {} } });
    click(); await settle(5); renderer.flush();
    assert.equal(requests.length, 2, "clipboard retry reuses the saved link");
    assert.match(renderer.tree.map(textOf).join(" "), /Copied/);
    assert.equal(renderer.findAll(node => node.type === "input").length, 0);
  } finally { renderer.unmount(); live.restore(); }
});

test("Share an invite link hides the URL while copying the real credential without creating or rotating it", async () => {
  const saved = invitation(), copied: string[] = [], requests: string[] = [];
  const live = installFakeBrowserEnvironment({ fetch: async (_url, init) => { requests.push(init?.method ?? "GET"); return Response.json({ enabled: true, invitation: saved }); } });
  Object.assign(window.location, { origin: "http://localhost" });
  Object.assign(navigator, { clipboard: { writeText: async (url: string) => { copied.push(url); } } });
  const { GroupInvitationPanel } = await import("./group-invitation-panel"), renderer = createHookRenderer({ expand: [GroupInvitationPanel] });
  try {
    renderer.render(createElement(GroupInvitationPanel, { slug: "qa" })); await settle(5); renderer.flush();
    const url = `http://localhost/group-join/${saved.token}/`;
    assert.deepEqual(renderer.findAll(node => node.type === "button").map(textOf), ["Share an invite link"]);
    assert.doesNotMatch(renderer.tree.map(textOf).join(" "), /http:\/\/localhost|g_aaaaaaaa/);
    const status = renderer.find(node => node.props.role === "status");
    assert.equal(textOf(status), "", "the announcement region exists before its text changes");
    assert.equal(status.props["aria-live"], "polite"); assert.equal(status.props["aria-atomic"], "true");
    for (let i = 0; i < 2; i++) { (renderer.find(node => node.type === "button").props.onClick as () => void)(); await settle(5); renderer.flush(); }
    assert.deepEqual(requests, ["GET"]); assert.deepEqual(copied, [url, url]);
    const row = renderer.find(node => node.type === "div" && node.props.className === "poll-action-row");
    assert.deepEqual(row.children.filter(child => typeof child !== "string").map(child => child.type), ["button", "span"], "confirmation is beside the same inline link");
    assert.equal(textOf(renderer.find(node => node.props.role === "status")), "Copied");
  } finally { renderer.unmount(); live.restore(); }
});

test("ineligible and unknown initial loads do not show invitation controls or misleading errors", async () => {
  const { GroupInvitationPanel } = await import("./group-invitation-panel");
  for (const response of [Response.json({ enabled: false }), Response.json({ error: "Unconfirmed account" }, { status: 401 }), Response.json({ error: "Not an organizer" }, { status: 403 }), Response.json({ error: "Unavailable" }, { status: 500 })]) {
    const live = installFakeBrowserEnvironment({ fetch: async () => response.clone() }), renderer = createHookRenderer({ expand: [GroupInvitationPanel] });
    try {
      renderer.render(createElement(GroupInvitationPanel, { slug: "outside-pilot" })); await settle(5); renderer.flush();
      assert.equal(renderer.findAll(node => node.type === "button" || node.props.role === "alert").length, 0);
      assert.doesNotMatch(renderer.tree.map(textOf).join(" "), /invite link|Invite your group/);
    } finally { renderer.unmount(); live.restore(); }
  }
});

test("renewal is explained and version-bound for expired or disabled links", async () => {
  const { GroupInvitationPanel } = await import("./group-invitation-panel");
  for (const state of ["expired", "revoked"]) {
    const old = { ...invitation(), version: 4, state, token: null }, requests: Array<Record<string, unknown>> = [];
    const live = installFakeBrowserEnvironment({ fetch: async (_url, init) => {
      if (init?.method !== "POST") return Response.json({ enabled: true, invitation: old });
      requests.push(JSON.parse(String(init.body))); return Response.json({ enabled: true, invitation: { ...invitation(), id: old.id, tripId: old.tripId, version: 5 } });
    } });
    Object.assign(window.location, { origin: "http://localhost" }); Object.assign(navigator, { clipboard: { writeText: async () => {} } });
    const renderer = createHookRenderer({ expand: [GroupInvitationPanel] });
    try {
      renderer.render(createElement(GroupInvitationPanel, { slug: "qa" })); await settle(5); renderer.flush();
      assert.match(renderer.tree.map(textOf).join(" "), /Share an invite link to create a new 14-day one/);
      (renderer.find(node => node.type === "button").props.onClick as () => void)(); await settle(5); renderer.flush();
      assert.equal(requests[0].action, "replace"); assert.equal(requests[0].expectedVersion, 4); assert.equal(requests[0].scopeAccepted, true);
    } finally { renderer.unmount(); live.restore(); }
  }
});
