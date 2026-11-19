import type { PollQuestion } from "@commons/contracts";

function option(id: string, label: string, description: string | null = null) {
  return { id, label, description, exclusive: false, url: null, resource: null };
}

export const EARLY_HOTEL_POLL_TEMPLATE = {
  id: "early-hotel",
  title: "Let’s pick where we’re staying.",
  intro: "Help us narrow down the hotel and shape the weekend.",
  questions: [
    {
      id: "72000000-0000-4000-8000-000000000001",
      kind: "choice",
      prompt: "Which hotel options would work for you?",
      required: true,
      selectionMode: "multiple",
      options: [
        option("72100000-0000-4000-8000-000000000001", "Charming inn", "Illustrative concept: simple, walkable, fewer amenities. Price not established."),
        option("72100000-0000-4000-8000-000000000002", "Polished boutique hotel", "Illustrative concept: design-forward with gathering spaces. Price not established."),
        option("72100000-0000-4000-8000-000000000003", "Resort and spa", "Illustrative concept: full service and on-site amenities. Price not established."),
      ],
    },
    {
      id: "72000000-0000-4000-8000-000000000002",
      kind: "choice",
      prompt: "What room setup works for you?",
      required: true,
      selectionMode: "single",
      options: [
        option("72200000-0000-4000-8000-000000000001", "I’d like my own room"),
        option("72200000-0000-4000-8000-000000000002", "I’m happy sharing a room, but want my own bed"),
        option("72200000-0000-4000-8000-000000000003", "I’m comfortable sharing a bed"),
        option("72200000-0000-4000-8000-000000000004", "I’m flexible"),
      ],
    },
    {
      id: "72000000-0000-4000-8000-000000000003",
      kind: "choice",
      prompt: "Will a baby be staying with you?",
      required: true,
      selectionMode: "single",
      options: [
        option("72300000-0000-4000-8000-000000000001", "No"),
        option("72300000-0000-4000-8000-000000000002", "Yes"),
        option("72300000-0000-4000-8000-000000000003", "Maybe"),
      ],
    },
    {
      id: "72000000-0000-4000-8000-000000000004",
      kind: "choice",
      prompt: "What matters most for the hotel?",
      required: true,
      selectionMode: "multiple",
      options: [
        option("72400000-0000-4000-8000-000000000001", "Walkable to restaurants and drinks"),
        option("72400000-0000-4000-8000-000000000002", "Pool or spa"),
        option("72400000-0000-4000-8000-000000000003", "A beautiful property where we can hang out"),
        option("72400000-0000-4000-8000-000000000004", "Easy access to wineries"),
        option("72400000-0000-4000-8000-000000000005", "Larger rooms or suites"),
        option("72400000-0000-4000-8000-000000000006", "Best possible value"),
      ],
    },
    { id: "72000000-0000-4000-8000-000000000005", kind: "text", prompt: "Do you belong to any wine clubs or have winery memberships?", required: false },
    { id: "72000000-0000-4000-8000-000000000006", kind: "text", prompt: "Any favorite wineries—or ones you’ve always wanted to visit?", required: false },
    {
      id: "72000000-0000-4000-8000-000000000007",
      kind: "choice",
      prompt: "Which food experiences should we prioritize?",
      required: true,
      selectionMode: "multiple",
      options: [
        option("72700000-0000-4000-8000-000000000001", "A long winery lunch"),
        option("72700000-0000-4000-8000-000000000002", "One special dinner"),
        option("72700000-0000-4000-8000-000000000003", "A tasting-menu experience"),
        option("72700000-0000-4000-8000-000000000004", "Casual local favorites"),
        option("72700000-0000-4000-8000-000000000005", "Brunch"),
        option("72700000-0000-4000-8000-000000000006", "Keep the schedule flexible"),
      ],
    },
    { id: "72000000-0000-4000-8000-000000000008", kind: "text", prompt: "Any dietary restrictions or strong food preferences?", required: false },
  ] satisfies PollQuestion[],
} as const;

/** Starters for the free stage's big questions. Blank choices are for the organizer to fill in; nothing is invented. */
const DECIDE_TEMPLATES = {
  "decide-where": { id: "decide-where", title: "Where should we go?", intro: "Pick every place you’d be happy with.", questions: [{ id: "73000000-0000-4000-8000-000000000001", kind: "choice", prompt: "Which of these would you go to?", required: true, selectionMode: "multiple", options: [option("73000000-0000-4000-8000-000000000011", ""), option("73000000-0000-4000-8000-000000000012", "")] }] },
  "decide-when": { id: "decide-when", title: "When can you go?", intro: "Pick every option that could work.", questions: [{ id: "73000000-0000-4000-8000-000000000002", kind: "choice", prompt: "Which dates could work?", required: true, selectionMode: "multiple", options: [option("73000000-0000-4000-8000-000000000021", ""), option("73000000-0000-4000-8000-000000000022", "")] }] },
  "decide-who": { id: "decide-who", title: "Are you in?", intro: "No commitment yet. We’re working out who can make it.", questions: [{ id: "73000000-0000-4000-8000-000000000003", kind: "choice", prompt: "Are you in?", required: true, selectionMode: "single", options: [option("73000000-0000-4000-8000-000000000031", "I’m in"), option("73000000-0000-4000-8000-000000000032", "Probably"), option("73000000-0000-4000-8000-000000000033", "Can’t make it")] }] },
} as unknown as Record<string, { id: string; title: string; intro: string; questions: PollQuestion[] }>;

export function getEarlyPollTemplate(templateId?: string) {
  if (templateId && templateId in DECIDE_TEMPLATES) return DECIDE_TEMPLATES[templateId];
  return templateId === EARLY_HOTEL_POLL_TEMPLATE.id ? EARLY_HOTEL_POLL_TEMPLATE : null;
}
