import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { createHookRenderer, registerComponentImportStubs, textOf } from "../lib/test-support/hook-harness";
import { installFakeLiveEnvironment, settle } from "../lib/test-support/fake-live-transport";
registerComponentImportStubs();

const status = (state: string, extra: object = {}) => ({ going: false, required: true, state, mayInvite: state === "allowed", draftId: "d", tripId: null, feeCents: 2000, checkoutOpen: false, failureCode: null, refundedCents: 0, reconciliationNeeded: false, savedPeople: [], unsentInvitees: [], ...extra });

async function render(current: () => object, props: object = {}) {
  const live = installFakeLiveEnvironment({ liveFetch: async (url, init) => {
    if (url.includes("/trip-activation/status")) return Response.json({ status: current() });
    if (url.includes("/checkout") && init?.method === "POST") return Response.json({ status: "processing" });
    return Response.json({});
  } });
  const { FirstInviteFlow } = await import("./first-invite-flow");
  const renderer = createHookRenderer({ expand: [FirstInviteFlow] });
  renderer.render(createElement(FirstInviteFlow, { draftId: "d", tripSlug: "trip", people: ["Sam", "Kit"], checkout: null, keepPlanning: { label: "Keep planning", href: "/c/trip" }, send: async () => ({ deliveries: [], slug: "trip" }), retryDelivery: async () => "failed" as const, doneHref: () => "/c/trip", ...props }));
  await settle(10); renderer.flush();
  return { renderer, live, text: () => renderer.tree.map(textOf).join(" ") };
}

for (const [state, expected] of [
  ["approval_revoked", /Inviting is paused/],
  ["payment_required", /\$20 for the whole trip.*including any tax/s], ["payment_processing", /Confirming your payment.*Nothing has been sent/s], ["refund_hold", /Inviting is on hold/],
] as const) {
  test(`${state} never offers to send`, async () => {
    const { text, live } = await render(() => status(state));
    try { assert.match(text(), expected); assert.doesNotMatch(text(), /Send \d/); } finally { live.restore(); }
  });
}

test("a return from checkout is not payment: it stays on confirming until the server says otherwise", async () => {
  const { text, live } = await render(() => status("payment_required"), { checkout: "returned" });
  try { assert.match(text(), /Confirming your payment/); assert.doesNotMatch(text(), /Paid|Send \d/); } finally { live.restore(); }
});

test("paid offers one separate send, and delivery states stay distinct", async () => {
  const { renderer, text, live } = await render(() => status("allowed"), { send: async () => ({ slug: "trip", deliveries: [
    { invitationId: "a", recipientName: "Sam", deliveryState: "sent" }, { invitationId: "b", recipientName: "Kit", deliveryState: "queued" }, { invitationId: "c", recipientName: "Jo", deliveryState: "failed" },
  ] }) });
  try {
    assert.match(text(), /We’re going · Send 2 invitations/);
    (renderer.find(node => node.type === "button" && /Send 2/.test(textOf(node))).props.onClick as () => void)();
    await settle(10); renderer.flush();
    assert.match(text(), /Sam\s*Sent/); assert.match(text(), /Kit\s*Queued/); assert.match(text(), /Jo\s*Not sent\s*Retry/);
    assert.doesNotMatch(text(), /Kit\s*Sent/, "queued is never called sent");
  } finally { live.restore(); }
});

test("a status failure says so and keeps the trip's saved state", async () => {
  const live = installFakeLiveEnvironment({ liveFetch: async () => new Response("no", { status: 503 }) });
  const { FirstInviteFlow } = await import("./first-invite-flow");
  const renderer = createHookRenderer({ expand: [FirstInviteFlow] });
  try {
    renderer.render(createElement(FirstInviteFlow, { draftId: "d", tripSlug: "trip", people: [], checkout: null, keepPlanning: { label: "Keep planning", href: "/c/trip" }, send: async () => ({ deliveries: [], slug: "trip" }), retryDelivery: async () => "failed" as const, doneHref: () => "/c/trip" }));
    await settle(10); renderer.flush();
    assert.match(renderer.tree.map(textOf).join(" "), /couldn’t check.*still saved/s);
  } finally { live.restore(); }
});

test("a fee-exempt beta trip offers the explicit send without paid or checkout copy", async () => {
  let sends = 0;
  const { renderer, text, live } = await render(() => status("exempt", { required: false, mayInvite: true, feeCents: 0 }), {
    send: async () => { sends += 1; return { deliveries: [], slug: "trip" }; },
  });
  try {
    assert.match(text(), /Ready to go\?/);
    assert.match(text(), /We’re going · Send 2 invitations/);
    assert.doesNotMatch(text(), /Paid|Pay \$20|Upgrade|Opening checkout/);
    assert.equal(sends, 0, "opening the flow sends nothing");
    (renderer.find(node => node.type === "button" && /Send 2/.test(textOf(node))).props.onClick as () => void)();
    await settle(10); renderer.flush();
    assert.equal(sends, 1);
  } finally { renderer.unmount(); live.restore(); }
});
