import type { CoordinatorPersonalityId } from "@commons/contracts";

// Authored evaluation fixtures, not generated replies or real trip evidence.
export const personalityScenario = {
  title: "One afternoon, two preferences",
  brief: "Six adults have Saturday afternoon free. Four want a museum; two prefer a quiet café. Everyone agreed to meet at the house at 6 PM. Prices, opening hours, and reservations have not been checked.",
  sharedPlan: "Make the museum and café optional parallel plans. Keep the 6 PM meetup. Ask who wants each option, then verify opening hours, prices, and any reservation requirements before confirming.",
};
export const personalityExamples: Record<CoordinatorPersonalityId, string> = {
  commons: "I’d keep both options: the museum for anyone interested, and a quiet café for those who prefer it. Everyone can meet back at the house at 6 PM. First, ask who wants each option. Then check opening hours, prices, and reservation requirements before confirming either plan.",
  joan: "There’s room for both preferences without making the afternoon complicated. I’d offer the museum and a quiet café as optional parallel plans, with everyone back at the house at 6 PM. Start by asking who wants each option. Then check opening hours, prices, and reservation requirements before confirming either plan.",
  becky: "Let’s give everyone an afternoon they want, then come back together at 6 PM at the house. I’d offer the museum and a quiet café as optional parallel plans. Ask who’s interested in each, then check opening hours, prices, and reservation requirements before confirming either plan.",
  miles: "I’d split the afternoon: museum or quiet café, each optional. Keep the 6 PM meetup at the house. That gives people a choice without losing the shared finish. Ask who wants each option, then check opening hours, prices, and reservation requirements before confirming either plan.",
};
