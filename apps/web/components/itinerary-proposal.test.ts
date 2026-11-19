import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { PollWorkingDraftSchema } from "@commons/contracts";
import { newItineraryDraft } from "../lib/itinerary-workshop";
import { createHookRenderer, registerComponentImportStubs } from "../lib/test-support/hook-harness";

registerComponentImportStubs();

test("itinerary approval requires opening the preview, and stale draft versions cannot apply", async () => {
  const { ProposalArtifact } = await import("./coordinator-workspace");
  const at = "2026-10-02T12:00:00.000Z";
  const draft = PollWorkingDraftSchema.parse({ id: "11111111-1111-4111-8111-111111111111", version: 1, data: newItineraryDraft("Synthetic trip"), createdAt: at, updatedAt: at, publishedPollId: null });
  const proposal = { baseVersion: 1, data: draft.data, changes: ["Move dinner"], state: "pending" as const };
  const renderer = createHookRenderer({ expand: [ProposalArtifact] });
  const actions: string[] = [];
  const props = { proposal, editable: [draft], busy: false, blocked: false, conflict: false, turnId: "turn", draftId: draft.id, onReview: (id:string) => actions.push(`review:${id}`), onAction: (id:string, kind:"apply"|"dismiss") => actions.push(`${kind}:${id}`) };
  const button = (label:string) => renderer.find(node => node.type === "button" && node.children.includes(label));
  renderer.render(createElement(ProposalArtifact, props));
  assert.equal(button("Apply to draft").props.disabled, true);
  (button("Review itinerary").props.onClick as () => void)();
  assert.deepEqual(actions, ["review:turn"]);
  renderer.render(createElement(ProposalArtifact, { ...props, previewed: true }));
  assert.equal(button("Apply to draft").props.disabled, false);
  renderer.render(createElement(ProposalArtifact, { ...props, previewed: true, editable: [{...draft, version:2}] }));
  assert.equal(button("Apply to draft").props.disabled, true);
  assert.equal(button("Keep current").props.disabled, false);
  renderer.unmount();
});
