export const coordinatorStarterVersion = 2;
export type CoordinatorStarterId = "dates" | "attendance" | "stay" | "question";
export type CoordinatorStarterFacts = { startsOn?: string | null; endsOn?: string | null };
type Starter = { id: CoordinatorStarterId; workflowKey: string; label: string; intent: string; opening: (facts: CoordinatorStarterFacts) => string };

// Stable IDs and pure definitions: new starters do not need another screen or
// create records until the organizer actually sends their first message.
export const coordinatorStarters: readonly Starter[] = [
  { id: "dates", workflowKey: "trip_feasibility", label: "Find dates and a destination", intent: "Help me ask the group about trip dates and destination", opening: facts => facts.startsOn ? `The trip currently starts on ${facts.startsOn}${facts.endsOn ? ` and ends on ${facts.endsOn}` : ""}. What is still undecided: those dates or the destination?` : "Which dates or destinations are you considering?" },
  { id: "attendance", workflowKey: "attendance_confirmation", label: "Confirm who is coming", intent: "Help me ask the group for final attendance confirmation", opening: () => "Are the trip dates and destination agreed? We can ask for a final yes or no." },
  { id: "stay", workflowKey: "lodging_selection", label: "Choose where to stay", intent: "Help me ask the group where to stay", opening: () => "Which lodging options should the group compare? Include any costs, room details and hotel links you already have." },
  { id: "question", workflowKey: "general_poll", label: "Ask something else", intent: "Help me ask the group", opening: () => "What are you trying to ask the group?" },
];

export function coordinatorStarter(id: CoordinatorStarterId) {
  return coordinatorStarters.find(starter => starter.id === id)!;
}

export function starterMessage(id: CoordinatorStarterId | null, text: string) {
  return id && id !== "question" ? `${coordinatorStarter(id).intent}.\n\n${text}` : text;
}
