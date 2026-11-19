/*
 * Reading a streamed chat completion (OpenAI-compatible SSE, as OpenRouter sends it) without trusting any of it early. The caller still validates the
 * complete text exactly as it validates a non-streamed completion; these helpers only let it show the reply prose sooner.
 */

export type StreamedCompletion = {
  text: string; finishReason: string | null; refusal: boolean; toolCalls: boolean;
  error: unknown; usage: Record<string, unknown> | null;
};

/** Reads `data:` lines until `[DONE]` or the end of the body. Comment lines (": OPENROUTER PROCESSING") and blank keep-alives are skipped. */
export async function readCompletionStream(body: ReadableStream<Uint8Array>, onText: (textSoFar: string) => void, maxChars = 32_000): Promise<StreamedCompletion> {
  const reader = body.pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>).getReader();
  const result: StreamedCompletion = { text: "", finishReason: null, refusal: false, toolCalls: false, error: null, usage: null };
  let buffer = "";
  const handle = (line: string) => {
    if (!line.startsWith("data:")) return false;
    const data = line.slice(5).trim();
    if (data === "[DONE]") return true;
    let chunk: { error?: unknown; usage?: unknown; choices?: Array<{ finish_reason?: string | null; error?: unknown; delta?: { content?: string | null; refusal?: unknown; tool_calls?: unknown[] } }> };
    try { chunk = JSON.parse(data); } catch { result.error ??= "unreadable_chunk"; return true; }
    if (chunk.error) result.error = chunk.error;
    if (chunk.usage && typeof chunk.usage === "object") result.usage = chunk.usage as Record<string, unknown>;
    const choice = chunk.choices?.[0];
    if (choice?.error) result.error = choice.error;
    if (choice?.delta?.refusal) result.refusal = true;
    if (choice?.delta?.tool_calls?.length) result.toolCalls = true;
    if (choice?.finish_reason) result.finishReason = choice.finish_reason;
    const content = choice?.delta?.content;
    if (typeof content === "string" && content) {
      result.text += content;
      if (result.text.length > maxChars) { result.error ??= "oversized"; return true; }
      onText(result.text);
    }
    return false;
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let newline: number, stop = false;
      while (!stop && (newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        stop = handle(line);
      }
      if (stop) break;
    }
    if (buffer.trim()) handle(buffer.trim());
  } finally { reader.cancel().catch(() => {}); }
  return result;
}

/**
 * The decoded value of a top-level JSON string property from an incomplete JSON document, for showing `reply` while the rest of the object is still
 * arriving. Returns null until the property's value has started. An escape sequence cut off at the end of the buffer is left out until it completes.
 * Inside JSON strings every quote is escaped, so `"reply":` can only match a real key.
 */
export function partialJsonString(buffer: string, key: string): { value: string; complete: boolean } | null {
  const start = new RegExp(`"${key}"\\s*:\\s*"`).exec(buffer);
  if (!start) return null;
  let value = "", index = start.index + start[0].length;
  while (index < buffer.length) {
    const char = buffer[index];
    if (char === '"') return { value, complete: true };
    if (char !== "\\") {
      // A raw high surrogate at the very end waits for its pair (a provider can split one emoji across two chunks).
      if (index === buffer.length - 1 && /[\uD800-\uDBFF]/.test(char)) break;
      value += char; index += 1; continue;
    }
    const next = buffer[index + 1];
    if (next === undefined) break;
    if (next === "u") {
      const hex = buffer.slice(index + 2, index + 6);
      if (hex.length < 4) break;
      const code = Number.parseInt(hex, 16);
      if (Number.isNaN(code)) break;
      // A high surrogate waits for its pair so an emoji is never shown as half a character.
      if (code >= 0xd800 && code <= 0xdbff) {
        const pair = /^\\u([0-9a-fA-F]{4})/.exec(buffer.slice(index + 6, index + 12));
        if (!pair) break;
        value += String.fromCharCode(code, Number.parseInt(pair[1], 16)); index += 12; continue;
      }
      value += String.fromCharCode(code); index += 6; continue;
    }
    value += ({ n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" } as Record<string, string>)[next] ?? next;
    index += 2;
  }
  return { value, complete: false };
}
