import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import type { CommonsParticipant, CommonsState } from "@commons/contracts";
import { createHookRenderer, registerComponentImportStubs, textOf } from "../lib/test-support/hook-harness";

// F7: the "Proposed alternative" Plan line is derived from a group message, so it follows the group-message pause.
registerComponentImportStubs();

const at = "2026-09-11T10:00:00.000Z";
const participants = [{ id: "casey", displayName: "Casey Synthetic", role: "organizer" }, { id: "robin", displayName: "Robin Synthetic", role: "member" }] as unknown as CommonsParticipant[];
const item = { id: "plan-1", title: "Sleigh ride", startsAt: "2027-02-13T22:00:00.000Z", status: "planned", participantScope: "subgroup", participantIds: ["casey"], provenanceLabel: "Added by Casey Synthetic" };
const state = {
  commonsId: "trip", participation: {}, expenses: [], reimbursements: [], moments: [], processedCommandIds: [], itinerary: [item], proposals: [], auditEvents: [], pollRequests: [],
  messages: [{ id: "m1", actorId: "robin", actorName: "Robin Synthetic", actorType: "human", body: "Alternative to Sleigh ride: Cocoa by the fire. Same time, everyone welcome.", occurredAt: at, source: "web" }],
} as unknown as CommonsState;

async function render(showAlternatives?: boolean) {
  const { SubgroupDetails } = await import("./commons-app");
  const renderer = createHookRenderer({ expand: [SubgroupDetails] });
  renderer.render(createElement(SubgroupDetails, { item: item as never, participants, state, ...(showAlternatives === undefined ? {} : { showAlternatives }) }));
  renderer.flush();
  const text = renderer.tree.map(textOf).join("\n");
  renderer.unmount();
  return text;
}

test("F7 the Proposed alternative line shows only while group messages are visible, and never while they are paused", async () => {
  const visible = await render(true);
  assert.match(visible, /Proposed alternative/);
  assert.match(visible, /Cocoa by the fire/);
  assert.match(visible, /Robin · Shared with the group/);
  const paused = await render(false);
  assert.doesNotMatch(paused, /Proposed alternative|Cocoa by the fire|Shared with the group/);
  assert.match(paused, /1 going/, "the participants are unaffected");
  assert.match(await render(), /Proposed alternative/, "the default keeps existing callers as they were");
});
