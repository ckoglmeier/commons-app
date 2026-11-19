import type { ThreadMessageLike } from "@assistant-ui/react";
import type { CoordinatorThread } from "@commons/contracts";

export type CommonsConversationTurn = CoordinatorThread["turns"][number];

/** Presentation only. A library message can never authorize a Commons command. */
export function assistantMessages(turns: readonly CommonsConversationTurn[]): ThreadMessageLike[] {
  return turns.flatMap(turn => {
    const status = turn.status ?? "completed";
    return [
      { id: `${turn.id}:user`, role: "user" as const, content: [{ type: "text" as const, text: turn.userText }] },
      { id: `${turn.id}:assistant`, role: "assistant" as const,
        content: [{ type: "text" as const, text: status === "completed" ? turn.assistantText : "" }],
        status: status === "pending" ? { type: "running" as const } : status === "failed"
          ? { type: "incomplete" as const, reason: "error" as const }
          : { type: "complete" as const, reason: "stop" as const },
      },
    ];
  });
}

export function commonsMessageText(content: readonly { type: string; text?: string }[]): string {
  if (content.some(part => part.type !== "text")) throw new Error("This conversation accepts text only. Nothing was sent.");
  const text = content.map(part => part.text ?? "").join("\n");
  if (!text.trim() || text.length > 2000) throw new Error("Write a message of up to 2,000 characters.");
  return text;
}
