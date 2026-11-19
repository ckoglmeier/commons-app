// Itinerary revisions carry a complete, schema-bounded draft, not just an ID.
export const LARGE_BODY_LIMIT = 1024 * 1024;

/** Command envelopes must be bounded even without a Content-Length header. */
export async function readBoundedJson(request: Request, limit = 4096): Promise<unknown> {
  if (Number(request.headers.get("content-length") ?? 0) > limit) throw new SyntaxError("Command too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError("Missing command.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new SyntaxError("Command too large."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
