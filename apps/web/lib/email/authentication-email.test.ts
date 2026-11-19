import assert from "node:assert/strict";
import test from "node:test";
import { renderCommonsAuthenticationEmail } from "./authentication-email";

test("renders a branded sign-in email with a text fallback", () => {
  const rendered = renderCommonsAuthenticationEmail({
    email: "Traveler@example.com",
    signInUrl: "https://commons.travel/auth/confirm?token_hash=secret&type=magiclink",
    intent: "sign-in",
  });

  assert.equal(rendered.subject, "Your Commons sign-in link");
  assert.match(rendered.html, /Pick up where you left off/);
  assert.match(rendered.html, /Sign in to Commons/);
  assert.match(rendered.html, /traveler@example\.com/);
  assert.match(rendered.text, /https:\/\/commons\.travel\/auth\/confirm/);
});

test("uses account and invitation language for their respective entry points", () => {
  const create = renderCommonsAuthenticationEmail({
    email: "traveler@example.com",
    signInUrl: "https://commons.travel/auth/confirm",
    intent: "create",
  });
  const invited = renderCommonsAuthenticationEmail({
    email: "traveler@example.com",
    signInUrl: "https://commons.travel/auth/confirm",
    intent: "invited",
  });

  assert.match(create.subject, /creating your Commons account/);
  assert.match(create.html, /Create account/);
  assert.match(invited.subject, /Continue to your event/);
  assert.match(invited.html, /Event invitation/);
});

test("continues a beta access request without promising immediate access", () => {
  const rendered = renderCommonsAuthenticationEmail({
    email: "traveler@example.com",
    signInUrl: "https://commons.travel/auth/confirm?next=%2Fnew%3Faccess%3Drequest",
    intent: "access",
  });

  assert.equal(rendered.subject, "Continue your Commons beta request");
  assert.match(rendered.html, /Request beta access/);
  assert.match(rendered.html, /Continue request/);
  assert.match(rendered.text, /request access to the Commons beta/);
});

test("rejects unsafe authentication links", () => {
  assert.throws(
    () => renderCommonsAuthenticationEmail({ email: "traveler@example.com", signInUrl: "javascript:alert(1)", intent: "sign-in" }),
    /HTTP or HTTPS/,
  );
});
