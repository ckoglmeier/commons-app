export type AttachedSource = { filename: string; text: string; limitations: string[] };
export class CoordinatorSourceBudgetError extends Error {}
/** Count the exact serialized source, including labels, before any inference. */
export function assembleCoordinatorSources(importText: string | undefined, sources: AttachedSource[] = []): string | undefined {
  const blocks = [importText, ...sources.map(source => `Source: ${source.filename}\n${source.text}\nLimitations: ${source.limitations.join(" ")}`)].filter((value): value is string => Boolean(value));
  const text = blocks.join("\n\n");
  if (text.length > 30000) throw new CoordinatorSourceBudgetError("Selected sources exceed 30,000 characters including filenames and limitations. Remove a source or use a smaller file; nothing was truncated.");
  return text || undefined;
}
