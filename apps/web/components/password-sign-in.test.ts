import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("an invitation only asks Supabase for an email proof when this copy can send the email", () => {
  const commons = read("lib/server/commons.ts");
  const delivery = commons.slice(commons.indexOf("export async function processInvitationDelivery"));
  // The proof's side effect is a passwordless account, which would block the traveler's own Create account in password mode.
  assert.match(delivery, /if \(!entry && isSupabaseAdminConfigured\(\) && emailDeliveryAvailable\(\)\) \{\n\s+const proof = await createPasswordlessEmailProof\(/);
  assert.match(commons, /import \{ EmailDeliveryError, emailDeliveryAvailable, sendEmail \} from "@\/lib\/email\/resend";/);
  const actions = read("app/sign-in/actions.ts");
  const links = actions.slice(actions.indexOf("export async function requestSignInLink"), actions.indexOf("const PasswordSchema"));
  assert.ok(links.indexOf('await currentSignInMethod() === "password"') < links.indexOf("createPasswordlessEntryUrl"), "a password copy never requests a sign-in link");
});

test("a failed attempt keeps the typed email, never the password", () => {
  const actions = read("app/sign-in/actions.ts");
  assert.match(actions, /email\?: string;/);
  assert.match(actions, /typeof value === "string" \? \{ email: value\.trim\(\)\.slice\(0, 254\) \} : \{\}/);
  const errors = [...actions.matchAll(/\{ status: "error", message: [^\n]*?\}/g)].map(match => match[0]);
  assert.ok(errors.length >= 14);
  // The shared "unavailable" helper is spread with the email where it is used.
  for (const error of errors.filter(line => !line.includes("Sign-in isn’t set up"))) assert.match(error, /\.\.\.kept \}$/, error);
  assert.match(actions, /if \(disabled\) return \{ \.\.\.disabled, \.\.\.kept \};/);
  assert.doesNotMatch(actions, /password: value|kept = .*password/);
  const password = read("app/sign-in/password-sign-in-form.tsx");
  assert.match(password, /name="email"[^>]*defaultValue=\{state\.email \?\? ""\}/);
  assert.doesNotMatch(password, /name="password"[^>]*defaultValue/);
  assert.match(read("app/sign-in/sign-in-form.tsx"), /name="email"[^>]*defaultValue=\{emailState\.email \?\? ""\}/);
});

test("the password form reads well on the dark invitation panel without changing the light card", () => {
  assert.match(read("app/sign-in/password-sign-in-form.tsx"), /<form className="auth-form auth-form--password" action=\{action\}>/);
  const css = read("app/globals.css");
  assert.match(css, /\.invite-arrival__redeem \.auth-form--password \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(css, /\.invite-arrival__redeem \.auth-form--password label \{ position: static;[^}]*color: var\(--cm-color-paper\); font-size: var\(--cm-text-meta\); font-weight: 700; \}/);
  assert.match(css, /\.invite-arrival__redeem \.auth-form--password \.auth-hint \{[^}]*color: var\(--cm-color-on-ink-secondary\);/);
  assert.match(css, /\.invite-arrival__redeem \.auth-form--password \.auth-switch \{[^}]*min-height: var\(--cm-touch-target\);[^}]*background: transparent;[^}]*color: var\(--cm-color-paper\);[^}]*text-decoration: underline; text-underline-offset: \.2em; \}/);
  assert.match(css, /\.invite-arrival__redeem \.auth-form--password \.auth-switch:focus-visible \{ outline: 3px solid var\(--cm-color-paper\);/);
  assert.match(css, /@media \(min-width: 768px\) \{[\s\S]*?\.invite-arrival__redeem \.auth-form--password \{ width: min\(100%, 30rem\); justify-self: end; \}/);
  for (const line of css.split("\n").filter(line => line.includes("auth-form--password"))) assert.match(line, /^\s*\.invite-arrival__redeem \.auth-form--password/, "only the invitation panel styles it");
});

test("the sign-in page says what a new person does and titles itself to match", () => {
  const page = read("app/sign-in/page.tsx");
  assert.match(page, /creating \? "Enter your email and choose a password\." : "Use your email and password\."/);
  assert.match(page, /export async function generateMetadata\(\{ searchParams \}/);
  assert.match(page, /const creating = intent === "create";\n {2}return \{ title: creating \? "Create account — Commons" : "Sign in — Commons", robots: \{ index: false, follow: false \}, referrer: "no-referrer" \};/);
  assert.match(page, /const creating = intent === "create";\n\n {2}return \(/, "the body derives creating the same way");
  assert.doesNotMatch(page, /export const metadata/);
});
