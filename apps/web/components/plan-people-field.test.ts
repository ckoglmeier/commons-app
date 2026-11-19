import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CommonsParticipant } from "@commons/contracts";
import { PlanPeopleField } from "./plan-people-field";

test("people picker includes managed travelers, excludes pending invites, and protects responses", () => {
  const person = (id: string, extra = {}): CommonsParticipant => ({ id, displayName: id, initials: id[0], role: "member", membershipStatus: "active", avatarUrl: null, ...extra });
  const html = renderToStaticMarkup(createElement(PlanPeopleField, {
    participants: [person("Adult"), person("Child", { accessMode: "managed", managedByPersonIds: ["Adult"] }), person("Pending", { membershipStatus: "invited" })],
    selectedIds: ["Adult", "Child"], protectedIds: ["Adult"], onChange: () => {},
  }));
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 2);
  assert.equal((html.match(/checked=""/g) ?? []).length, 2);
  assert.equal((html.match(/disabled=""/g) ?? []).length, 1);
  assert.match(html, /Managed traveler/);
  assert.match(html, /not a personal RSVP/);
  assert.doesNotMatch(html, /Pending/);
});
