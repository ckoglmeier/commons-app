import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

// Password sign-in: the typed address proves nothing. Account creation never matches an invited person by email; only the private
// link the account arrived through can make it that person.
// Each call loads a fresh copy (a unique suffix), so one test's state never leaks into the next.
async function loadCompleteAccount() {
  const stub = `export const state={method:'password',placed:{status:'claimed',personId:'casey'},textMessaging:false,linkCalls:[],emailCalls:[],redirects:[]};
    export const headers=async()=>new Headers();export const getDevSignInIdentity=async()=>null;export const isSupabaseAuthConfigured=()=>true;export const startDevSession=async()=>({});
    export const recordOutcome=()=>{};
    export const redirect=path=>{state.redirects.push(path);throw new Error('REDIRECT')};
    export const commonsDatabaseUrl=()=> 'synthetic';export const textMessagingAvailable=()=>state.textMessaging;
    export const safeAuthNext=value=>value&&value.startsWith('/')?value:'/trips';export const hasCompletedAccountName=metadata=>!!metadata?.first_name;
    export const currentSignInMethod=async()=>state.method;
    export const findOrClaimPersonForAuthIdentity=async identity=>{state.emailCalls.push(identity);return 'own-person'};
    export const findOrClaimPersonForInvitationLink=async(token,identity)=>{state.linkCalls.push({token,identity});return state.placed};
    export const createSupabaseServerClient=async()=>({auth:{getUser:async()=>({data:{user:{id:'account-b',user_metadata:{}}}}),updateUser:async()=>({data:{user:{id:'account-b',email:'casey@example.com'}}})}});`;
  const imports = new Set(["@commons/database", "next/headers", "next/navigation", "@/lib/server/outcome-telemetry", "@/lib/server/runtime-environment", "@/lib/supabase/server", "@/lib/supabase/config", "@/lib/server/dev-session", "@/lib/server/sign-in-method", "@/lib/auth-flow", "qa-state"]);
  const bundle = await build({ stdin: { contents: "export {completeAccount} from './app/account/create/actions';export {state} from 'qa-state';", resolveDir: process.cwd() }, bundle: true, write: false, format: "esm", platform: "node", plugins: [{ name: "fake-dependencies", setup(b) { b.onResolve({ filter: /.*/ }, args => imports.has(args.path) ? { path: "shared", namespace: "fake" } : undefined); b.onLoad({ filter: /.*/, namespace: "fake" }, () => ({ contents: stub })); } }] });
  return await import(`data:text/javascript;base64,${Buffer.from(`${bundle.outputFiles[0]!.text}\n// ${Math.random()}`).toString("base64")}`) as {
    completeAccount: (previous: object, form: FormData) => Promise<{ message?: string }>;
    state: { method: string; placed: { status: string; personId?: string }; textMessaging: boolean; linkCalls: Array<{ token: string; identity: Record<string, unknown> }>; emailCalls: Array<Record<string, unknown>>; redirects: string[] };
  };
}

function form(next: string) {
  const data = new FormData();
  data.set("firstName", "Casey");
  data.set("next", next);
  return data;
}

test("password sign-in: an account arriving through a private link becomes that invited person by the link, not by email", async () => {
  const client = await loadCompleteAccount();
  await assert.rejects(client.completeAccount({}, form("/join/link%2Btoken")), /REDIRECT/);
  assert.equal(client.state.linkCalls.length, 1);
  assert.equal(client.state.linkCalls[0]!.token, "link+token");
  assert.equal(client.state.linkCalls[0]!.identity.emailProvesIdentity, false);
  assert.equal(client.state.emailCalls.length, 0, "a placed account is not resolved again by email");
  assert.deepEqual(client.state.redirects, ["/join/link%2Btoken"]);
});

test("password sign-in: without a usable link the account gets its own profile, never one matched by its typed email", async () => {
  const client = await loadCompleteAccount();
  client.state.placed = { status: "unavailable" };
  await assert.rejects(client.completeAccount({}, form("/join/expired-token")), /REDIRECT/);
  assert.equal(client.state.emailCalls.length, 1);
  assert.equal(client.state.emailCalls[0]!.emailProvesIdentity, false);
  await assert.rejects(client.completeAccount({}, form("/trips")), /REDIRECT/);
  assert.equal(client.state.linkCalls.length, 1, "only a /join link is tried");
  assert.equal(client.state.emailCalls[1]!.emailProvesIdentity, false);
});

test("password sign-in: a managed traveler's link makes no profile and skips the phone step until they accept", async () => {
  const client = await loadCompleteAccount();
  client.state.placed = { status: "managed" };
  client.state.textMessaging = true;
  await assert.rejects(client.completeAccount({}, form("/join/managed-token")), /REDIRECT/);
  assert.equal(client.state.emailCalls.length, 0);
  assert.deepEqual(client.state.redirects, ["/join/managed-token"]);
});

test("emailed sign-in links: account creation matches by the confirmed email as before and never by link", async () => {
  const client = await loadCompleteAccount();
  client.state.method = "link";
  await assert.rejects(client.completeAccount({}, form("/join/some-token")), /REDIRECT/);
  assert.equal(client.state.linkCalls.length, 0);
  assert.equal(client.state.emailCalls.length, 1);
  assert.equal(client.state.emailCalls[0]!.emailProvesIdentity, true);
});
