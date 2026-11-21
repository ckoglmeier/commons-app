import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { registerComponentImportStubs } from "../test-support/hook-harness";

registerComponentImportStubs(); // `server-only` must be stubbed before the route loads

/* Synthetic: no Supabase project is reached. The settings only make the copy look configured. */
const SUPABASE_ENV = { NEXT_PUBLIC_SUPABASE_URL: "https://supabase.example.com", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "synthetic" };
const emailRequest = () => new Request("http://localhost/api/v1/profile/contact", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "email", value: "maya.new@example.com" }) });

function withEnvironment(values: Record<string, string | undefined>) {
  const saved = Object.fromEntries(Object.keys(values).map(name => [name, process.env[name]]));
  for (const [name, value] of Object.entries(values)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  return () => { for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } };
}

test("a copy that signs in with passwords refuses to change the email, in plain words", async () => {
  const restore = withEnvironment({ ...SUPABASE_ENV, COMMONS_EMAIL_SEND_MODE: "disabled", RESEND_API_KEY: undefined, COMMONS_EMAIL_FROM: undefined });
  try {
    const { POST } = await import("../../app/api/v1/profile/contact/route");
    const response = await POST(emailRequest());
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "Your email can’t be changed here. To change it, ask the person who runs this copy of Commons.");
  } finally { restore(); }
});

test("a copy that emails sign-in links still goes on to request the change", async () => {
  const restore = withEnvironment({ ...SUPABASE_ENV, COMMONS_EMAIL_SEND_MODE: "log" });
  try {
    const { POST } = await import("../../app/api/v1/profile/contact/route");
    // It gets past the refusal and reaches the Supabase session, which needs a real request's cookies.
    await assert.rejects(POST(emailRequest()), /`cookies` was called outside a request scope/);
  } finally { restore(); }
});

test("in password mode the profile shows no email edit control and says who can change it", () => {
  const source = readFileSync(new URL("../../components/profile-contact-methods.tsx", import.meta.url), "utf8");
  assert.match(source, /\{passwordSignIn \? null : <button type="button" onClick=\{begin\}>\{email \? "Edit" : "Add"\}<\/button>\}/);
  assert.match(source, /\{passwordSignIn \? <small>To change it, ask the person who runs this copy of Commons\.<\/small> : null\}/);
  assert.match(source, /\{editing && !passwordSignIn \? <form/);
});
