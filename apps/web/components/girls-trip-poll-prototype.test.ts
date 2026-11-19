import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("girls trip poll prototype keeps every answer scoped to the trip", async () => {
  const [source, css] = await Promise.all([
    readFile(new URL("../app/prototype/girls-trip-poll-invite/girls-trip-poll-prototype.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/prototype/girls-trip-poll-invite/girls-trip-poll-prototype.module.css", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(source, /Continue to the trip|These answers are stored|No account setup needed/);
  assert.match(source, /Revise my response/);
  assert.match(source, /Dietary needs/);
  assert.doesNotMatch(source, /Store your trip preferences/);
  assert.match(source, /Which hotel options would work for you/);
  assert.match(source, /About \$450 each/);
  assert.match(source, /About \$700 each/);
  assert.match(source, /About \$1,000 each/);
  assert.match(source, /6b043aa5-4c4d-4515-a884-e3d1c9fa9968/);
  assert.match(source, /Share poll with group/);
  assert.match(source, /Conversation todo/);
  assert.match(source, /Organizer view/);
  assert.match(source, /No sample votes are shown/);
  assert.match(source, /coverImageUrl/);
  assert.match(source, /Trip cover preview/);
  assert.match(source, /cinema/);
  assert.match(source, /postcard/);
  assert.match(source, /reveal/);
  assert.match(source, /Baby plans/);
  for (const label of ["Hotel options", "Room setup", "Baby plans", "Hotel priorities", "Food priorities", "Wine memberships", "Favorite wineries", "Dietary needs"]) {
    assert.equal(source.match(new RegExp(`<dt>${label}</dt>`, "g"))?.length, 2, `${label} appears in the participant receipt and organizer results`);
  }
  assert.doesNotMatch(source, /phone|SMS|text message/i);
  assert.match(css, /min-height:\s*100dvh/);
  assert.match(css, /min-height:\s*var\(--cm-touch-target\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.coverHero/);
  assert.match(css, /@keyframes cinema-push/);
  assert.match(css, /@keyframes postcard-photo/);
  assert.match(css, /@keyframes curtain-left/);
});

test("the production early hotel template stores every prototype question", async () => {
  const [template, responseForm] = await Promise.all([
    readFile(new URL("../lib/early-poll-templates.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/poll/[token]/poll-response-form.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(template, /early-hotel/);
  assert.match(template, /Which hotel options would work for you/);
  assert.match(template, /wine clubs or have winery memberships/);
  assert.match(template, /dietary restrictions or strong food preferences/);
  assert.match(responseForm, /poll-text-question/);
  assert.match(responseForm, /answer\.text/);
});

test("polls and invitations reveal only their scoped trip cover", async () => {
  const [pollPage, invitationPage, scopedRepository] = await Promise.all([
    readFile(new URL("../app/c/poll/[publicId]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/join/[token]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../../packages/database/src/scoped-cover-repository.ts", import.meta.url), "utf8"),
  ]);

  assert.match(pollPage, /public-poll-cover/);
  assert.match(invitationPage, /InvitationEntryForm/);
  assert.match(invitationPage, /SignInForm/);
  assert.match(scopedRepository, /polls\.publicId/);
  assert.match(scopedRepository, /invitations\.tokenHash/);
  assert.match(scopedRepository, /invitations\.status, "pending"/);
  assert.doesNotMatch(scopedRepository, /memberships/);
});
