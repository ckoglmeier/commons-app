import type { PlanTemplate } from "./format";

function option(id: string, label: string) {
  return { id, label, description: null, exclusive: false, url: null, resource: null };
}

/**
 * Example of a non-travel-first template: a family reunion. Households arrive at different times, share a house and
 * meals, and pick optional outings. It is still called a trip in the interface.
 */
export const familyReunionTemplate: PlanTemplate = {
  key: "family-reunion",
  version: 1,
  label: "Family reunion",
  description: "Households, arrival times, shared meals and optional outings.",
  welcomeQuestions: [
    { id: "where", title: "Where will we gather?", help: "A family home, a rented house or a town. Add it, or ask the family." },
    { id: "when", title: "Which weekend?", help: "Add the dates, or ask which weekends work for each household." },
    { id: "who", title: "Which households are coming?", help: "Add who’s coming, or ask each household." },
  ],
  defaultPolls: [
    {
      id: "reunion-where", forQuestion: "where", title: "Where should we gather?", intro: "Pick every place that would work for your household.",
      questions: [{ id: "74000000-0000-4000-8000-000000000001", kind: "choice", prompt: "Which of these would work?", required: true, selectionMode: "multiple", options: [option("74000000-0000-4000-8000-000000000011", ""), option("74000000-0000-4000-8000-000000000012", "")] }],
    },
    {
      id: "reunion-when", forQuestion: "when", title: "Which weekend works for your household?", intro: "Pick every weekend you could make.",
      questions: [{ id: "74000000-0000-4000-8000-000000000002", kind: "choice", prompt: "Which weekends could work?", required: true, selectionMode: "multiple", options: [option("74000000-0000-4000-8000-000000000021", ""), option("74000000-0000-4000-8000-000000000022", "")] }],
    },
    {
      id: "reunion-who", forQuestion: "who", title: "Is your household coming?", intro: "No commitment yet. We’re working out who can make it.",
      questions: [
        { id: "74000000-0000-4000-8000-000000000003", kind: "choice", prompt: "Is your household coming?", required: true, selectionMode: "single", options: [option("74000000-0000-4000-8000-000000000031", "We’re coming"), option("74000000-0000-4000-8000-000000000032", "Probably"), option("74000000-0000-4000-8000-000000000033", "Can’t make it")] },
        { id: "74000000-0000-4000-8000-000000000004", kind: "text", prompt: "Who in your household is coming, and how old are the kids?", required: false },
      ],
    },
    {
      id: "reunion-arrivals", title: "When are you arriving?", intro: "So we can plan rides, beds and the first dinner.",
      questions: [
        { id: "74000000-0000-4000-8000-000000000005", kind: "choice", prompt: "When will your household arrive?", required: true, selectionMode: "single", options: [option("74000000-0000-4000-8000-000000000051", "Thursday"), option("74000000-0000-4000-8000-000000000052", "Friday"), option("74000000-0000-4000-8000-000000000053", "Saturday morning")] },
        { id: "74000000-0000-4000-8000-000000000006", kind: "choice", prompt: "Do you need a ride from the airport or station?", required: true, selectionMode: "single", options: [option("74000000-0000-4000-8000-000000000061", "Yes"), option("74000000-0000-4000-8000-000000000062", "No, we’re driving"), option("74000000-0000-4000-8000-000000000063", "Not sure yet")] },
        { id: "74000000-0000-4000-8000-000000000007", kind: "text", prompt: "Any dietary needs or allergies we should plan meals around?", required: false },
      ],
    },
  ],
  openQuestions: [
    "Who’s hosting the big dinner?",
    "Where is everyone sleeping?",
    "Are we doing a family photo?",
  ],
  planSections: {
    activities: { label: "Get-togethers" },
    travel: { label: "Arrivals & rooms" },
    outline: [
      "Arrival day · Settle in and share an easy dinner",
      "Together day · Family photo, a shared lunch and an optional outing",
      "Departure day · Breakfast and staggered goodbyes",
    ],
  },
  todos: [
    { title: "Collect each household’s arrival time" },
    { title: "Plan the shared groceries" },
    { title: "Book the family photo" },
  ],
  money: {
    costRules: [
      { label: "House or venue", basis: "shared" },
      { label: "Groceries and the big dinner", basis: "shared" },
      { label: "Travel to get there", basis: "per_person" },
      { label: "Outings", basis: "optional" },
    ],
  },
};
