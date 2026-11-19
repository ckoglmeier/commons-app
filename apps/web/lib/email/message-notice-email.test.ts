import assert from "node:assert/strict";
import test from "node:test";
import { renderMessageNoticeEmail } from "./message-notice-email";

test("the message notice names the trip, links to the thread and carries no message text", () => {
  const email = renderMessageNoticeEmail({ recipientName: "Maya", tripNames: ["Sonoma Weekend", "Sonoma Weekend"], threadUrl: "https://trips.example.test/messages" });
  assert.equal(email.subject, "New message from Commons about Sonoma Weekend");
  assert.match(email.text, /^Hi Maya,/);
  assert.match(email.text, /https:\/\/trips\.example\.test\/messages/);
  assert.match(email.html, /href="https:\/\/trips\.example\.test\/messages"/);
  assert.match(email.text, /one email until you open your messages/);
  assert.equal(renderMessageNoticeEmail({ tripNames: ["A", "B", "C"], threadUrl: "https://x.test/messages" }).subject, "New message from Commons about 3 of your trips");
  assert.equal(renderMessageNoticeEmail({ tripNames: ["<b>Tahoe</b>"], threadUrl: "https://x.test/messages" }).html.includes("<b>Tahoe</b>"), false, "trip names are escaped");
  assert.throws(() => renderMessageNoticeEmail({ tripNames: [], threadUrl: "javascript:alert(1)" }));
});
