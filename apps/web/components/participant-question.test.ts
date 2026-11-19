import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import type { CoordinatorGoal, OrganizerParticipantQuestion, RecipientParticipantQuestion } from "@commons/contracts";
import { createHookRenderer, registerComponentImportStubs, textOf, type RenderedNode } from "../lib/test-support/hook-harness";

registerComponentImportStubs();

const slug = "synthetic-trip", qid = "11111111-1111-4111-8111-111111111111", person = "22222222-2222-4222-8222-222222222222";
const at = "2026-10-20T12:00:00.000Z", later = "2026-10-22T12:00:00.000Z";
const settle = async (renderer: ReturnType<typeof createHookRenderer>) => { for (let i = 0; i < 8; i += 1) { await new Promise(resolve => setTimeout(resolve, 2)); renderer.flush(); } };
const button = (renderer: ReturnType<typeof createHookRenderer>, label: string | RegExp) => renderer.find(node => node.type === "button" && (typeof label === "string" ? textOf(node as RenderedNode) === label : label.test(textOf(node as RenderedNode))));
const click = (node: { props: Record<string, unknown> }) => (node.props.onClick as (event: unknown) => void)({ currentTarget: {} });
const text = (renderer: ReturnType<typeof createHookRenderer>) => renderer.tree.map(textOf).join("\n");
const has = (renderer: ReturnType<typeof createHookRenderer>, label: string | RegExp) => renderer.findAll(node => node.type === "button" && (typeof label === "string" ? textOf(node as RenderedNode) === label : label.test(textOf(node as RenderedNode)))).length > 0;

function environment(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const store = new Map<string, string>(), calls: Array<{ url: string; init?: RequestInit; body?: Record<string, unknown> }> = [];
  const original = { fetch: globalThis.fetch, window: (globalThis as { window?: unknown }).window, raf: (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame };
  (globalThis as { window?: unknown }).window = { setTimeout, clearTimeout, sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } };
  (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (callback: () => void) => { callback(); return 0; };
  globalThis.fetch = (async (url: string, init?: RequestInit) => { calls.push({ url: String(url), init, body: init?.body ? JSON.parse(String(init.body)) : undefined }); return handler(String(url), init); }) as typeof fetch;
  return { store, calls, restore() { globalThis.fetch = original.fetch; (globalThis as { window?: unknown }).window = original.window; (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = original.raf; } };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const recipientView = (over: Partial<RecipientParticipantQuestion> = {}): RecipientParticipantQuestion => ({
  questionId: qid, tripId: person, tripName: "Synthetic Peak weekend", askedBy: "Casey Synthetic", purpose: "Airport pickup", question: "What time do you land on Friday?",
  expiresAt: later, state: "waiting", sharedWith: ["Casey Synthetic", "Robin Synthetic"], answer: null, canAnswer: true, ...over,
});

async function mountAnswer(initial: RecipientParticipantQuestion) {
  const { ParticipantQuestionAnswer } = await import("./participant-question-answer");
  const renderer = createHookRenderer({ expand: [ParticipantQuestionAnswer] });
  renderer.render(createElement(ParticipantQuestionAnswer, { slug, initial })); renderer.flush(); await settle(renderer);
  const type = (value: string) => { const area = renderer.find(node => node.type === "textarea"); (area.props.onChange as (event: unknown) => void)({ target: { value } }); renderer.flush(); };
  const submit = async () => { const form = renderer.find(node => node.type === "form"); (form.props.onSubmit as (event: unknown) => void)({ preventDefault() {} }); await settle(renderer); };
  return { renderer, type, submit };
}

test("the answer form says who sees the answer before the button, and sends submissionId, body and revision 0", async () => {
  const env = environment(() => json({ questionId: qid, revision: 1, submissionId: "x", answeredAt: at, replayed: false }));
  try {
    const { renderer, type, submit } = await mountAnswer(recipientView());
    const html = text(renderer);
    assert.match(html, /Shared with Casey Synthetic and Robin Synthetic \(this trip’s organizers\)\. Only this answer is shared. Nothing else from your trip\./);
    assert.ok(html.indexOf("Only this answer is shared") < html.indexOf("Share my answer"));
    type("Landing at 4:10 PM"); await submit();
    const post = env.calls.find(call => call.init?.method === "POST")!;
    assert.deepEqual(Object.keys(post.body!).sort(), ["body", "expectedAnswerRevision", "submissionId"]);
    assert.equal(post.body!.body, "Landing at 4:10 PM"); assert.equal(post.body!.expectedAnswerRevision, 0); assert.match(String(post.body!.submissionId), /^[0-9a-f-]{36}$/);
    assert.match(text(renderer), /Shared with Casey Synthetic and Robin Synthetic at /);
    assert.ok(has(renderer, "Correct my answer"));
    assert.equal(env.store.size, 0, "the stored attempt is cleared after a confirmed receipt");
  } finally { env.restore(); }
});

test("a retry after a dropped response resends the identical submission", async () => {
  let attempts = 0;
  const env = environment(() => { attempts += 1; if (attempts === 1) throw new TypeError("network"); return json({ questionId: qid, revision: 1, submissionId: "x", answeredAt: at, replayed: true }); });
  try {
    const { renderer, type, submit } = await mountAnswer(recipientView());
    type("Landing at 4:10 PM"); await submit();
    assert.equal(renderer.findAll(node => node.props.role === "alert").length, 1);
    await submit();
    const posts = env.calls.filter(call => call.init?.method === "POST");
    assert.equal(posts.length, 2);
    assert.deepEqual(posts[1].body, posts[0].body);
    assert.match(text(renderer), /Shared with/);
  } finally { env.restore(); }
});

test("a reload reuses the stored submission id and unsent text", async () => {
  const env = environment(() => { throw new TypeError("network"); });
  try {
    const first = await mountAnswer(recipientView());
    first.type("Landing at 4:10 PM"); await first.submit();
    const sent = env.calls.find(call => call.init?.method === "POST")!.body!;
    assert.ok(env.store.has(`commons:question:${qid}:rev:0`));
    first.renderer.unmount();
    const second = await mountAnswer(recipientView());
    assert.equal(second.renderer.find(node => node.type === "textarea").props.value, "Landing at 4:10 PM");
    await second.submit();
    const again = env.calls.filter(call => call.init?.method === "POST")[1].body!;
    assert.deepEqual(again, sent);
  } finally { env.restore(); }
});

test("a correction is explicit, uses the saved revision and a fresh submission id", async () => {
  const env = environment(() => json({ questionId: qid, revision: 3, submissionId: "x", answeredAt: later, replayed: false }));
  try {
    const { renderer, type, submit } = await mountAnswer(recipientView({ state: "answered", answer: { revision: 2, body: "Landing at 4:10 PM", answeredAt: at } }));
    assert.ok(!renderer.findAll(node => node.type === "textarea").length, "a saved answer is not an open form");
    click(button(renderer, "Correct my answer")); renderer.flush();
    assert.equal(renderer.find(node => node.type === "textarea").props.value, "Landing at 4:10 PM");
    type("Landing at 6:00 PM"); await submit();
    const post = env.calls.find(call => call.init?.method === "POST")!.body!;
    assert.equal(post.expectedAnswerRevision, 2); assert.equal(post.body, "Landing at 6:00 PM");
  } finally { env.restore(); }
});

test("a closed question keeps the saved answer visible and removes the form", async () => {
  const env = environment(() => json({ error: { code: "closed", message: "This question is closed, so a new answer can’t be saved. Your earlier answer, if any, is unchanged." } }, 409));
  try {
    const { renderer, type, submit } = await mountAnswer(recipientView());
    type("Late"); await submit();
    assert.match(text(renderer), /This question is closed/);
    assert.ok(!renderer.findAll(node => node.type === "textarea").length);
  } finally { env.restore(); }
});

const goal = { goalId: "33333333-3333-4333-8333-333333333333", title: "Airport transfers", revision: 4, lifecycle: "working", ownedByMe: true } as unknown as CoordinatorGoal;
const draft: OrganizerParticipantQuestion = {
  questionId: qid, goalId: goal.goalId, goalRevision: 4, state: "draft", version: 2, purpose: "Airport pickup", question: "What time do you land on Friday?",
  recipient: { personId: person, name: "Robin Synthetic" }, askedBy: { personId: "44444444-4444-4444-8444-444444444444", name: "Casey Synthetic" }, expiresAt: later, publishedAt: null,
  visibility: "task_organizers", answer: null, canManage: true,
};

test("the organizer draft review says nothing is sent and publish posts the question version", async () => {
  const env = environment((_url, init) => init?.method === "POST" ? json({ questionId: qid, version: 3, replayed: false }) : json({ enabled: true, questions: [draft], recipients: [{ personId: person, name: "Robin Synthetic", organizer: false }] }));
  try {
    const { GoalParticipantQuestions } = await import("./participant-question-ask");
    const renderer = createHookRenderer({ expand: [GoalParticipantQuestions] });
    renderer.render(createElement(GoalParticipantQuestions, { slug, goal })); await settle(renderer);
    assert.match(text(renderer), /Nothing is sent\. Making it available lets Robin Synthetic answer in Commons. Commons doesn’t text or email them\./);
    assert.match(text(renderer), /Draft · not shared yet/);
    assert.ok(has(renderer, "Discard draft"));
    click(button(renderer, "Make available to Robin")); await settle(renderer);
    const post = env.calls.find(call => call.init?.method === "POST")!.body!;
    assert.equal(post.action, "publish"); assert.equal(post.questionId, qid); assert.equal(post.expectedVersion, 2); assert.match(String(post.commandId), /^[0-9a-f-]{36}$/);
    assert.match(text(renderer), /No message was sent\./);
  } finally { env.restore(); }
});

test("nothing renders when the lane is off and there are no questions", async () => {
  const env = environment(() => json({ enabled: false, questions: [], recipients: [] }));
  try {
    const { GoalParticipantQuestions } = await import("./participant-question-ask");
    const renderer = createHookRenderer({ expand: [GoalParticipantQuestions] });
    renderer.render(createElement(GoalParticipantQuestions, { slug, goal })); await settle(renderer);
    assert.equal(renderer.tree.length, 0);
  } finally { env.restore(); }
});

test("Home next steps link only waiting questions the traveler can answer", async () => {
  const other = "55555555-5555-4555-8555-555555555555";
  const env = environment(() => json({ questions: [recipientView(), recipientView({ questionId: other, state: "answered", answer: { revision: 1, body: "x", answeredAt: at } }), recipientView({ questionId: "66666666-6666-4666-8666-666666666666", state: "waiting", canAnswer: false })] }));
  try {
    const { ParticipantQuestionNextSteps } = await import("./participant-question-next-steps");
    const renderer = createHookRenderer({ expand: [ParticipantQuestionNextSteps] });
    renderer.render(createElement(ParticipantQuestionNextSteps, { slug })); await settle(renderer);
    const links = renderer.findAll(node => typeof node.props.href === "string").map(node => String(node.props.href));
    assert.deepEqual(links, [`/c/${slug}/questions/${qid}`]);
    assert.match(text(renderer), /Casey Synthetic asked you a question/);
    assert.match(text(renderer), /What time do you land on Friday\?/);
    assert.match(text(renderer), /Answer by/);
  } finally { env.restore(); }
});

test("a failed Home read renders nothing", async () => {
  const env = environment(() => { throw new TypeError("offline"); });
  try {
    const { ParticipantQuestionNextSteps } = await import("./participant-question-next-steps");
    const renderer = createHookRenderer({ expand: [ParticipantQuestionNextSteps] });
    renderer.render(createElement(ParticipantQuestionNextSteps, { slug })); await settle(renderer);
    assert.equal(renderer.tree.length, 0);
  } finally { env.restore(); }
});
