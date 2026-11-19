import test from "node:test";
import assert from "node:assert/strict";
import { publishedPollAccessScope, publishedPollHtml, publishedPollMessage, publishedPollSms, publishedPollUrl } from "./coordinator-sharing";

const poll = { presentationVersion: 2 as const, title: "Where should we stay?", intro: "We chose Sonoma. Now choose our base.", ballotMode: "transparent" as const, questions: [], communication: { heading: "Choose a hotel", paragraphs: ["Nothing is booked."], links: [] } };

test("a self-shared poll exposes a repeatable public link and makes its access boundary explicit", () => {
  const url = publishedPollUrl("https://commons.example/", "abcdef123456");
  assert.equal(url, "https://commons.example/c/poll/abcdef123456");
  assert.equal(publishedPollMessage(poll, url), "Choose a hotel\n\nNothing is booked.\n\nWhere should we stay?\n\nWe chose Sonoma. Now choose our base.\n\nVote in Commons: https://commons.example/c/poll/abcdef123456");
  assert.equal(publishedPollSms(poll, url), "Where should we stay?\n\nVote: https://commons.example/c/poll/abcdef123456");
  assert.match(publishedPollAccessScope, /doesn’t grant trip membership/i);
});

test("rich email copy escapes participant text and only accepts HTTP resources", () => {
  const html = publishedPollHtml({ ...poll, communication: { heading: '<img src=x onerror="alert(1)"> 🏡', paragraphs: ["A & B\nNext line"], links: [{ label: "Source", url: 'https://example.com/?q="hello"&x=2' }] } }, "https://commons.example/c/poll/abc");
  assert.match(html, /&lt;img/);
  assert.match(html, /🏡/);
  assert.match(html, /A &amp; B<\/p><p[^>]*>Next line/);
  assert.match(html, /href="https:\/\/example.com\/\?q=&quot;hello&quot;&amp;x=2"/);
  assert.match(html, />Vote in Commons<\/a>/);
  assert.doesNotMatch(html, /javascript:|<img|onclick=/);
  assert.throws(() => publishedPollHtml({ ...poll, communication: { heading: "Unsafe", paragraphs: [], links: [{ label: "Unsafe", url: "javascript:alert(1)" }] } }, "https://commons.example/c/poll/abc"));
});

test("legacy poll copy preserves its original combined message", () => {
  const legacy = { ...poll, presentationVersion: undefined };
  const url = publishedPollUrl("https://commons.example", "legacy123");
  assert.equal(publishedPollMessage(legacy, url), "Choose a hotel\n\nNothing is booked.\n\nVote in Commons: https://commons.example/c/poll/legacy123");
  assert.doesNotMatch(publishedPollHtml(legacy, url), /Commons poll/);
});
