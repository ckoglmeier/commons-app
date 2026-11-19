import assert from "node:assert/strict";
import test from "node:test";
import { renderConversationDigestEmail } from "./conversation-digest-email";

test("renders conversation from multiple events in one restrained digest", () => {
  const rendered = renderConversationDigestEmail({
    eventsUrl: "https://commons.travel/trips",
    payload: {
      recipientAuthUserId: "auth-1",
      recipientName: "Alex",
      events: [
        {
          name: "Scotland 2027",
          slug: "scotland-2027",
          messageCount: 2,
          expenseCount: 1,
          messages: [
            { actorName: "Jordan", body: "I found two cottages near Skye.", occurredAt: "2026-08-31T12:00:00.000Z" },
            { actorName: "Sam", body: "Let’s compare cancellation policies.", occurredAt: "2026-08-31T13:00:00.000Z" },
          ],
          expenses: [
            { title: "Cottage deposit", amountCents: 12550, currency: "USD", paidByName: "Jordan", addedAt: "2026-08-31T14:00:00.000Z" },
          ],
        },
        {
          name: "Dinner in Denver",
          slug: "dinner-denver",
          messageCount: 1,
          messages: [
            { actorName: "Taylor", body: "Thursday works for me.", occurredAt: "2026-08-31T14:00:00.000Z" },
          ],
        },
      ],
    },
  });

  assert.equal(rendered.subject, "What changed in 2 trips");
  assert.match(rendered.html, /Here’s what changed/);
  assert.match(rendered.html, /Scotland 2027/);
  assert.match(rendered.html, /Jordan/);
  assert.match(rendered.html, /Open your trips/);
  assert.match(rendered.html, /https:\/\/commons\.travel\/c\/scotland-2027/);
  assert.match(rendered.text, /Thursday works for me/);
  assert.match(rendered.html, /Cottage deposit · \$125\.50/);
  assert.match(rendered.text, /Paid by Jordan/);
  assert.doesNotMatch(rendered.html, /AI-powered|magic|engagement/i);
});

test("renders an expense-only digest", () => {
  const rendered = renderConversationDigestEmail({
    eventsUrl: "https://commons.travel/trips",
    payload: {
      recipientAuthUserId: "auth-1",
      recipientName: "Alex",
      events: [{
        name: "Friends Weekend",
        slug: "friends-weekend",
        messageCount: 0,
        expenseCount: 1,
        messages: [],
        expenses: [{
          title: "Rental house",
          amountCents: 80000,
          currency: "USD",
          paidByName: "Taylor",
          addedAt: "2026-08-31T12:00:00.000Z",
        }],
      }],
    },
  });

  assert.equal(rendered.subject, "What changed in Friends Weekend");
  assert.match(rendered.html, /Here’s what changed/);
  assert.match(rendered.html, /Open Friends Weekend/);
  assert.match(rendered.html, /https:\/\/commons\.travel\/c\/friends-weekend/);
  assert.match(rendered.text, /Rental house · \$800\.00/);
});

test("renders shared trip changes without exposing private detail fields", () => {
  const rendered = renderConversationDigestEmail({
    eventsUrl: "https://commons.travel/trips",
    payload: {
      recipientAuthUserId: "auth-1",
      recipientName: "Alex",
      events: [{
        name: "Spring Break",
        slug: "spring-break",
        startsOn: "2027-03-20",
        endsOn: "2027-03-26",
        locationNames: ["Laguna Beach, CA", "San Diego, CA"],
        activityCount: 2,
        activities: [
          { summary: "Trip cover changed.", occurredAt: "2026-09-03T12:00:00.000Z", priority: 6 },
          { summary: "Stay added: Laguna House.", occurredAt: "2026-09-03T13:00:00.000Z", priority: 1 },
        ],
        messageCount: 0,
        messages: [],
      }],
    },
  });

  assert.match(rendered.html, /2 trip changes/);
  assert.match(rendered.html, /March 20–26, 2027 · Laguna Beach, CA · San Diego, CA/);
  assert.match(rendered.html, /Trip cover changed/);
  assert.match(rendered.text, /Stay added: Laguna House/);
  assert.match(rendered.html, /unshared costs, confirmation documents/);
});

test("prioritizes meaningful updates and caps each trip at five highlights", () => {
  const rendered = renderConversationDigestEmail({
    eventsUrl: "https://commons.travel/trips",
    payload: {
      recipientAuthUserId: "auth-1",
      recipientName: "Alex",
      events: [{
        name: "Spring Break",
        slug: "spring-break",
        activityCount: 6,
        activities: [
          { summary: "Trip cover changed.", occurredAt: "2026-09-03T18:00:00.000Z", priority: 6 },
          { summary: "Trip details changed.", occurredAt: "2026-09-03T17:00:00.000Z", priority: 4 },
          { summary: "Stay updated: Laguna House.", occurredAt: "2026-09-03T16:00:00.000Z", priority: 1 },
          { summary: "Plan added: Dinner.", occurredAt: "2026-09-03T15:00:00.000Z", priority: 1 },
          { summary: "Poll opened: Beach day.", occurredAt: "2026-09-03T14:00:00.000Z", priority: 1 },
          { summary: "Photo added: Sunset.", occurredAt: "2026-09-03T13:00:00.000Z", priority: 5 },
        ],
        messageCount: 1,
        messages: [{ actorName: "Jordan", body: "The late flight works for us.", occurredAt: "2026-09-03T19:00:00.000Z" }],
      }],
    },
  });

  assert.match(rendered.html, /The late flight works for us/);
  assert.match(rendered.html, /Stay updated: Laguna House/);
  assert.match(rendered.html, /2 more shared updates in Commons/);
  assert.doesNotMatch(rendered.html, /Trip cover changed/);
});

test("escapes participant-authored digest content", () => {
  const rendered = renderConversationDigestEmail({
    eventsUrl: "https://commons.travel/trips",
    payload: {
      recipientAuthUserId: "auth-1",
      recipientName: "Alex",
      events: [{
        name: "Trip <script>",
        slug: "trip",
        messageCount: 1,
        messages: [{ actorName: "Jordan", body: "<script>alert(1)</script>", occurredAt: "2026-08-31T12:00:00.000Z" }],
      }],
    },
  });
  assert.doesNotMatch(rendered.html, /<script>alert/);
  assert.match(rendered.html, /&lt;script&gt;/);
});
