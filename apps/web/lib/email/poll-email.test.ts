import assert from "node:assert/strict";
import test from "node:test";
import { renderPollEmail } from "./poll-email";

test("poll email is content-free with one scoped link and a text fallback", () => {
  const rendered = renderPollEmail("https://www.commons.travel/private?secret=not-forwarded", "abcdef123456");
  assert.match(rendered.text, /https:\/\/www.commons.travel\/c\/poll\/abcdef123456/);
  assert.match(rendered.html, /Sign in with the email/);
  assert.match(rendered.text, /does not confirm attendance/);
  assert.doesNotMatch(JSON.stringify(rendered), /secret|not-forwarded|private\?/);
});
test("poll email rejects invalid IDs and non-web destinations", () => {
  assert.throws(() => renderPollEmail("https://www.commons.travel", 'abc"><script>'));
  assert.throws(() => renderPollEmail("javascript:alert(1)", "abcdef123456"));
  assert.throws(() => renderPollEmail("http://www.commons.travel", "abcdef123456"));
});

test("poll email separates the organizer note from a structured poll block", () => {
  const rendered = renderPollEmail("https://www.commons.travel", "abcdef123456", {
    title: "Where should we stay?",
    intro: "We chose Sonoma. Now choose our home base.",
    communication: { heading: "A quick choice", paragraphs: ["----------\n• We have two nights\n• Nothing is booked"], links: [] },
    questions: [{ id: "10000000-0000-4000-8000-000000000001", kind: "choice", prompt: "Which hotel works?", required: true, selectionMode: "single", options: [
      { id: "10000000-0000-4000-8000-000000000002", label: "The Lodge", description: null, exclusive: false },
      { id: "10000000-0000-4000-8000-000000000003", label: "The Inn", description: null, exclusive: false },
    ] }],
  });
  assert.doesNotMatch(rendered.html, /----------/);
  assert.match(rendered.html, /<ul[^>]*>.*We have two nights.*Nothing is booked.*<\/ul>/);
  assert.match(rendered.html, /Commons poll/);
  assert.match(rendered.html, /Where should we stay\?/);
  assert.match(rendered.html, /The Lodge/);
  assert.match(rendered.html, />Vote in Commons<\/a>/);
});
