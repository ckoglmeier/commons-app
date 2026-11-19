import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PeopleResults } from "./people-results";
import type { CommonsParticipant } from "@commons/contracts";

test("Logistics roster includes managed travelers as joined, without people controls", () => {
  const participants = [
    { id: "adult", displayName: "Alex", initials: "AL", role: "organizer", membershipStatus: "active", accessMode: "account" },
    { id: "managed", displayName: "Sam", initials: "SA", role: "member", membershipStatus: "active", accessMode: "managed" },
    { id: "invited", displayName: "Taylor", initials: "TA", role: "member", membershipStatus: "invited", accessMode: "account" },
  ] as CommonsParticipant[];
  const html = renderToStaticMarkup(createElement(PeopleResults, { participants }));
  assert.match(html, /2 Joined · 1 Invited/);
  assert.match(html, /Managed traveler/);
  assert.doesNotMatch(html, /<button|<input|<form|Attending|Who’s coming/);
});

test("compact traveler entry remains visible and the shared modal restores focus", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const modal = await readFile(new URL("./modal-layer.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(css, /\.trip-cover--compact \.cover-people[^\n]*display: none/);
  assert.match(modal, /previousFocus\?\.focus/);
  assert.match(modal, /event.key !== "Tab"/);
  assert.match(modal, /event.key === "Escape"/);
});
