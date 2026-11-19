"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { AssistantRuntimeProvider, ThreadPrimitive, MessagePrimitive, ActionBarPrimitive, useExternalStoreRuntime } from "@assistant-ui/react";
import { assistantMessages, commonsMessageText, type CommonsConversationTurn } from "@/lib/coordinator-assistant-ui";
import { isSendShortcut } from "@/lib/coordinator-client";

const TransportContext = createContext<null | { send: (text: string) => void }>(null);
const MessageContents = createContext<ReactNode>(null);
function MessageRootContents() { return <MessagePrimitive.Root asChild>{useContext(MessageContents)}</MessagePrimitive.Root>; }
const messageComponents = { Message: MessageRootContents };

/** No library persistence or cloud service: Commons owns every turn and effect. */
export function CommonsAssistantRuntime({ turns, running, onSend, onStop, children }: {
  turns: readonly CommonsConversationTurn[]; running: boolean;
  onSend: (text: string) => Promise<unknown>; onStop: () => Promise<void>; children: ReactNode;
}) {
  const messages = useMemo(() => assistantMessages(turns), [turns]);
  const runtime = useExternalStoreRuntime({
    messages, convertMessage: message => message, isRunning: running,
    onNew: async message => { await onSend(commonsMessageText(message.content)); },
    onCancel: onStop,
    // Deliberately no edit, regenerate, branch or tool-result callback: those
    // would circumvent Commons' versioned proposals and command retry IDs.
  });
  const transport = useMemo(() => ({ send: (text: string) => runtime.thread.append({ role: "user", content: [{ type: "text", text }] }) }), [runtime]);
  return <AssistantRuntimeProvider runtime={runtime}><TransportContext.Provider value={transport}>{children}</TransportContext.Provider></AssistantRuntimeProvider>;
}

export function CommonsMessage({ messageId, children }: { messageId: string; children: ReactNode }) {
  const transport = useContext(TransportContext);
  // External-store sync happens after the host render. ID lookup tolerates the
  // brief interval before a newly persisted turn reaches the library runtime.
  return transport ? <MessageContents.Provider value={children}><ThreadPrimitive.Unstable_MessageById messageId={messageId} components={messageComponents} /></MessageContents.Provider> : children;
}

export function CommonsReplyText({ text }: { text: string }) {
  const transport = useContext(TransportContext);
  return transport ? <><MessagePrimitive.Parts /><ActionBarPrimitive.Copy className="cm-action cm-action--quiet" aria-label="Copy Commons reply">Copy reply</ActionBarPrimitive.Copy></> : <p>{text}</p>;
}

/** Keep destination-scoped unsent text and queue ownership in the Commons host.
 * The runtime forwards submits to the same durable send path, not a new API. */
export function CommonsComposerForm({ children, text, canSend, fallback }: {
  children: ReactNode; text: string; canSend: boolean; fallback: () => void;
}) {
  const transport = useContext(TransportContext);
  const send = () => { if (canSend) { if (transport) transport.send(text); else fallback(); } };
  // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- The labelled textarea's documented send shortcut delegates through its form.
  return <form className="review-composer" onSubmit={event => { event.preventDefault(); send(); }} onKeyDown={event => {
    if (event.target instanceof HTMLTextAreaElement && isSendShortcut(event)) { event.preventDefault(); send(); }
  }}>{children}</form>;
}
