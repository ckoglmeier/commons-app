import { z } from "zod";
import { PollWorkingDataSchema } from "./poll";
import { ItineraryContentSchema, type ItineraryContent } from "./research-itinerary";
export const ItineraryDocumentRevisionSchema = z.object({
  commandId: z.string().uuid(), documentId: z.string().uuid(), threadId: z.string().uuid(),
  version: z.number().int().positive(), actorId: z.string().uuid(), source: z.enum(["human", "coordinator", "undo"]),
  contextDigest: z.string().length(64), at: z.string().datetime(), undoable: z.boolean(), before: ItineraryContentSchema.nullable(), after: ItineraryContentSchema,
}).strict();
export type ItineraryDocumentRevision = z.infer<typeof ItineraryDocumentRevisionSchema>;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]));
  return value;
}
export const itineraryContentEqual = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const same = itineraryContentEqual;
export class ItineraryUndoConflict extends Error { constructor() { super("That text changed again. Review the current version before undoing this change."); } }
/** Conditional inverse through stable IDs, including nested day rows. */
export function undoStructuredDocument<T>(current: T, before: T, after: T): T {
  function inverse(value: unknown, old: unknown, next: unknown): unknown {
    if (same(old, next)) return structuredClone(value);
    if ((Array.isArray(old) || old == null) && (Array.isArray(next) || next == null) && Array.isArray(value)) {
      const a = (old ?? []) as Record<string, unknown>[], b = (next ?? []) as Record<string, unknown>[];
      const all = [...a, ...b];
      const identity = all.length && all.every(row => row && typeof row === "object" && "id" in row) ? "id" : all.length && all.every(row => row && typeof row === "object" && "day" in row) ? "day" : null;
      if (identity) {
        const rows = structuredClone(value) as Record<string, unknown>[];
        for (const id of new Set([...a, ...b].map(row => row[identity]))) {
          const prior = a.find(row => row[identity] === id), edited = b.find(row => row[identity] === id), index = rows.findIndex(row => row[identity] === id);
          if (same(prior, edited)) continue;
          if (!prior) {
            if (index < 0 || !same(rows[index], edited)) throw new ItineraryUndoConflict();
            rows.splice(index, 1);
          } else if (!edited) {
            if (index >= 0) throw new ItineraryUndoConflict();
            const position = a.findIndex(row => row[identity] === id);
            const predecessor = a.slice(0, position).reverse().find(row => rows.some(item => item[identity] === row[identity]));
            const successor = a.slice(position + 1).find(row => rows.some(item => item[identity] === row[identity]));
            const insert = predecessor ? rows.findIndex(row => row[identity] === predecessor[identity]) + 1 : successor ? rows.findIndex(row => row[identity] === successor[identity]) : rows.length;
            rows.splice(insert, 0, structuredClone(prior));
          } else {
            if (index < 0) throw new ItineraryUndoConflict();
            rows[index] = inverse(rows[index], prior, edited) as Record<string, unknown>;
          }
        }
        const common = a.map(row => row[identity]).filter(id => b.some(row => row[identity] === id));
        const orderedAfter = b.map(row => row[identity]).filter(id => common.includes(id));
        if (!same(common, orderedAfter)) {
          if (!same(rows.map(row => row[identity]).filter(id => common.includes(id)), orderedAfter)) throw new ItineraryUndoConflict();
          const orderedBefore = common.map(id => rows.find(row => row[identity] === id)!); let position = 0;
          for (let index = 0; index < rows.length; index++) if (common.includes(rows[index][identity])) rows[index] = orderedBefore[position++];
        }
        return !rows.length && old == null ? old : rows;
      }
    }
    if (old && next && value && typeof old === "object" && typeof next === "object" && typeof value === "object" && !Array.isArray(old) && !Array.isArray(next) && !Array.isArray(value)) {
      const a = old as Record<string, unknown>, b = next as Record<string, unknown>, result = structuredClone(value) as Record<string, unknown>;
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (same(a[key], b[key])) continue;
        const restored = inverse(result[key], a[key], b[key]);
        if (restored === undefined) delete result[key]; else result[key] = restored;
      }
      return result;
    }
    if (!same(value, next)) throw new ItineraryUndoConflict();
    return structuredClone(old);
  }
  return inverse(current, before, after) as T;
}
/** Reverse only this revision's fields; canonical records are never inputs to this function. */
export function undoItineraryRevision(current: ItineraryContent, before: ItineraryContent, after: ItineraryContent): ItineraryContent {
  return ItineraryContentSchema.parse(undoStructuredDocument(current, before, after));
}

export const LegacyItineraryRevisionSchema = z.object({
  commandId: z.string().uuid(), documentId: z.string().uuid(), threadId: z.string().uuid().nullable(), version: z.number().int().positive(),
  actorId: z.string().uuid(), source: z.enum(["human", "coordinator"]), at: z.string().datetime(),
  before: PollWorkingDataSchema.nullable(), after: PollWorkingDataSchema,
}).strict();
export type LegacyItineraryRevision = z.infer<typeof LegacyItineraryRevisionSchema>;
