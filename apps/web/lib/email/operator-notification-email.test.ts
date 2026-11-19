import assert from "node:assert/strict";
import test from "node:test";
import { renderOperatorNotificationEmail } from "./operator-notification-email";

test("feedback notifications include the message, category and safe page without treating submitted names as verified", () => {
  const email = renderOperatorNotificationEmail({ kind: "feedback", feedbackId: "qa-saved-report", submission: {
    questionVersion: 2, source: "feedback_button", commonsSlug: "qa", respondentName: "<Someone>",
    answers: { category: "problem", message: '<img src=x onerror="alert(1)">\nCannot save.' },
    pagePath: "/c/qa?view=logistics&token=private", idempotencyKey: "00000000-0000-4000-8000-000000000001",
  } }, "https://www.commons.travel");
  assert.equal(email.subject, "Commons: problem reported");
  assert.match(email.text, /Cannot save/);
  assert.match(email.text, /Feedback reference: qa-saved-report/);
  assert.match(email.text, /name supplied by the browser/);
  assert.match(email.html, /&lt;img/);
  assert.doesNotMatch(email.html, /<img src=x|token=private/);
  assert.match(email.html, /https:\/\/www.commons.travel\/c\/qa\?view=logistics/);
});

test("daily analytics stays aggregate-only and links to the operator dashboard", () => {
  const email = renderOperatorNotificationEmail({ kind: "daily_analytics", report: {
    periodKey: "2026-09-17", startsAt: "2026-09-17T06:00:00.000Z", endsAt: "2026-09-18T06:00:00.000Z",
    activePeople: 4, sessions: 7, pageViews: 19, tripsCreated: 1, peopleCreated: 2,
    invitationsSent: 3, invitationsAccepted: 1, messages: 8, pollsCreated: 1,
    pollResponses: 5, plansAdded: 2, staysAdded: 0, expensesAdded: 1, photosAdded: 0,
    feedbackSubmitted: 1, betaAccessRequested: 2,
    topEvents: [{ name: "group_message_sent", count: 8 }, { name: "page_view", count: 19 }],
  } }, "https://www.commons.travel");
  assert.equal(email.subject, "Commons daily report: September 17, 2026");
  assert.match(email.text, /4 signed-in people/);
  assert.match(email.text, /3 invites sent/);
  assert.match(email.text, /2 beta-access requests/);
  assert.match(email.text, /group message sent/);
  assert.match(email.html, /Open Commons admin/);
  assert.match(email.html, /Aggregate operating data only/);
  assert.match(email.text, /does not include trip messages, receipts, or private travel details/);
});

test("access notifications link to authenticated review, not an automatic approval", () => {
  const email = renderOperatorNotificationEmail({ kind: "beta_access", email: "requester@example.com", personId: "qa" }, "https://www.commons.travel");
  assert.equal(email.subject, "Commons: new beta access request");
  assert.match(email.text, /requester@example.com/);
  assert.match(email.text, /does not approve access/);
  assert.match(email.html, /href="https:\/\/www.commons.travel\/admin"/);
});
