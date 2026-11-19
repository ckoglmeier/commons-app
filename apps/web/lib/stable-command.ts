/** A command id that stays the same while the content is the same, so a double click or retry replays instead of duplicating. */
export function stableCommand(store: { key: string; id: string } | null, content: unknown) {
  const key = JSON.stringify(content);
  return store && store.key === key ? store : { key, id: globalThis.crypto.randomUUID() };
}
