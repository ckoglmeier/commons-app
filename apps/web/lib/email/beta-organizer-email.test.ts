import assert from "node:assert/strict";
import test from "node:test";
import { renderBetaOrganizerEmail } from "./beta-organizer-email";

test("beta invitation points to authenticated creation without granting trip access", () => {
  const email = renderBetaOrganizerEmail("https://www.commons.travel");
  assert.match(email.text, /sign-in\?intent=create&next=%2Fnew/);
  assert.match(email.text, /email this invitation was sent to/);
  assert.match(email.html, /doesn’t add you to a trip/);
  assert.doesNotMatch(email.html, /token_hash/);
  assert.throws(() => renderBetaOrganizerEmail("javascript:alert(1)"));
});

test("personal messages keep line breaks and cannot inject email HTML", () => {
  const message = 'Come plan with us.\n<script>alert("x")</script> & friends';
  const email = renderBetaOrganizerEmail("https://www.commons.travel", message);
  assert.ok(email.text.includes(message));
  assert.match(email.html, /&lt;script&gt;/);
  assert.doesNotMatch(email.html, /<script>/);
  assert.match(email.html, /white-space:pre-wrap/);
});
