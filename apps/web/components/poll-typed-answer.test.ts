import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { PublicPollSchema, type PollAnswer, type PublicPoll } from "@commons/contracts";
import { createHookRenderer, registerComponentImportStubs, textOf } from "@/lib/test-support/hook-harness";
import { installFakeBrowserEnvironment, settle } from "@/lib/test-support/fake-browser-environment";

registerComponentImportStubs();
test("typed participant answers require explicit ranking, review/save/reload/edit all payloads and abstention", async () => {
  const options = ["Montreal", "Denver"].map(label => ({ id: crypto.randomUUID(), label, place: { name: label } }));
  const questions = [{ id: crypto.randomUUID(), kind: "option_response", scale: "interest", prompt: "Interest", required: true, options }, { id: crypto.randomUUID(), kind: "ranking", prompt: "Rank", required: true, options }, { id: crypto.randomUUID(), kind: "allocation", totalPoints: 10, prompt: "Points", required: true, options }];
  const initial = PublicPollSchema.parse({ id: crypto.randomUUID(), publicId: "123456abcdef", event: { slug: "qa", name: "QA" }, title: "Typed preferences", intro: null, status: "open", ballotMode: "transparent", questions, createdByName: "Organizer", createdAt: "2026-10-11T00:00:00Z", responseCount: 0, aggregates: [], resultsVisible: true, identityBound: true, authenticatedName: "Taylor QA" });
  const requests: Array<{ answers: PollAnswer[]; expectedResponseUpdatedAt?: string }> = [];
  let persisted: PublicPoll = initial;
  const live = installFakeBrowserEnvironment({ fetch: async (_url, init) => {
    const body = JSON.parse(String(init?.body)); requests.push(body);
    persisted = { ...initial, responseCount: 1, ownResponse: { respondentName: "Taylor QA", answers: body.answers, updatedAt: `2026-10-11T0${requests.length}:00:00Z` } };
    return Response.json({ poll: persisted, receiptToken: crypto.randomUUID() + crypto.randomUUID() });
  } });
  window.scrollTo = () => {};
  const { PollResponseForm } = await import("../app/poll/[token]/poll-response-form");
  const { PollTypedAnswer } = await import("./poll-typed-answer");
  let renderer = createHookRenderer({ expand: [PollResponseForm, PollTypedAnswer] });
  const submit = () => { (renderer.find(node => node.type === "form").props.onSubmit as (event: unknown) => void)({ preventDefault() {} }); renderer.flush(); };
  const change = (label: string, value: string) => { (renderer.find(node => node.props["aria-label"] === label).props.onChange as (event: unknown) => void)({ target: { value } }); renderer.flush(); };
  try {
    renderer.render(createElement(PollResponseForm, { token: initial.publicId, initialPoll: initial })); await settle(5); renderer.flush();
    assert.equal(renderer.find(node => node.props["aria-label"] === "Montreal: rank").props.value, "", "screen order is not a submitted ranking");
    change("Montreal: response", "could_go"); change("Denver: response", "top_choice");
    submit(); assert.equal(requests.length, 0); assert.match(renderer.tree.map(textOf).join(" "), /Answer “Rank”/);
    change("Montreal: rank", "2"); change("Denver: rank", "1");
    change("Montreal: points", "3"); change("Denver: points", "6");
    submit(); assert.equal(requests.length, 0); assert.match(renderer.tree.map(textOf).join(" "), /exactly 10 points/);
    change("Denver: points", "7"); submit();
    assert.match(renderer.tree.map(textOf).join(" "), /Montreal: Could go/); assert.match(renderer.tree.map(textOf).join(" "), /1\. Denver/); assert.match(renderer.tree.map(textOf).join(" "), /Denver: 7 points/);
    submit(); await settle(5); renderer.flush();
    assert.equal(requests.length, 1); assert.deepEqual(requests[0].answers[1].rankedOptionIds, [options[1].id, options[0].id]);
    assert.deepEqual(requests[0].answers[2].allocations?.map(row => row.points), [3, 7]);
    renderer.unmount(); renderer = createHookRenderer({ expand: [PollResponseForm, PollTypedAnswer] });
    renderer.render(createElement(PollResponseForm, { token: initial.publicId, initialPoll: persisted })); await settle(5); renderer.flush();
    (renderer.find(node => node.type === "button" && textOf(node) === "Edit my response").props.onClick as () => void)(); renderer.flush();
    assert.equal(renderer.find(node => node.props["aria-label"] === "Montreal: response").props.value, "could_go");
    assert.equal(renderer.find(node => node.props["aria-label"] === "Denver: rank").props.value, "1");
    assert.equal(renderer.find(node => node.props["aria-label"] === "Denver: points").props.value, 7);
    for (const checkbox of renderer.findAll(node => node.type === "input" && node.props.type === "checkbox")) (checkbox.props.onChange as (event: unknown) => void)({ target: { checked: true } });
    renderer.flush(); submit(); assert.match(renderer.tree.map(textOf).join(" "), /Abstained/);
    submit(); await settle(5); renderer.flush();
    assert.equal(requests.length, 2); assert.equal(requests[1].expectedResponseUpdatedAt, "2026-10-11T01:00:00Z");
    assert.deepEqual(requests[1].answers.slice(1).map(answer => ({ abstained: answer.abstained, ranking: answer.rankedOptionIds, points: answer.allocations })), [{ abstained: true, ranking: undefined, points: undefined }, { abstained: true, ranking: undefined, points: undefined }]);
  } finally { renderer.unmount(); live.restore(); }
});
