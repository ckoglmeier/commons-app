import assert from "node:assert/strict";
import test from "node:test";
import { contactUpdateError, normalizePhone } from "./contact-methods";

test("normalizes US and international mobile numbers", () => {
  assert.equal(normalizePhone("(415) 555-0142"), "+14155550142");
  assert.equal(normalizePhone("+44 20 7946 0958"), "+442079460958");
  assert.equal(normalizePhone("020 7946 0958"), null);
});

test("contact conflicts stop without implying an automatic merge", () => {
  assert.equal(
    contactUpdateError("phone", { code: "identity_already_exists" }),
    "That mobile number is already connected to another Commons account.",
  );
  assert.equal(
    contactUpdateError("email", { message: "A user with this email already exists" }),
    "That email is already connected to another Commons account.",
  );
});
