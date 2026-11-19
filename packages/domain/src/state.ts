import type {
  CommonsState,
  ConversationMessage,
} from "@commons/contracts";

export function appendConversationMessage(
  currentState: CommonsState,
  message: ConversationMessage,
): CommonsState {
  if (currentState.messages.some((existing) => existing.id === message.id)) {
    return currentState;
  }

  return {
    ...currentState,
    messages: [...currentState.messages, message].sort((a, b) =>
      a.occurredAt.localeCompare(b.occurredAt),
    ),
  };
}

export function setParticipation(
  currentState: CommonsState,
  personId: string,
  response: "in" | "maybe" | "skip",
): CommonsState {
  return {
    ...currentState,
    participation: {
      ...currentState.participation,
      [personId]: response,
    },
  };
}
