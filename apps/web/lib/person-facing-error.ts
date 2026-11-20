/*
 * Which error text a person may see.
 * Commons's own messages ("Only organizers can do that.") pass through; a browser's network text, a JSON parser's complaint,
 * a database driver's query or a runtime's stack never do. Plain module so client components and server routes can both use it.
 */

/** Shown when a request never reached this copy of Commons. */
export const CONNECTION_ERROR_MESSAGE = "Couldn’t connect. Check your connection and try again.";

export type ErrorKind = "person" | "network" | "technical";

const NETWORK_MESSAGE = /^(?:Failed to fetch|Load failed|NetworkError when attempting to fetch resource|Network request failed|The network connection was lost|The Internet connection appears to be offline|fetch failed)/i;
const TECHNICAL_NAMES = new Set(["AbortError", "TimeoutError", "ZodError", "PostgresError", "DrizzleQueryError", "DrizzleError"]);
const TECHNICAL_PROPERTIES = ["query", "severity", "routine", "syscall", "errno"];

function isBuiltInTechnicalError(error: Error) {
  if (error instanceof TypeError || error instanceof SyntaxError || error instanceof RangeError || error instanceof ReferenceError || error instanceof URIError || error instanceof EvalError) return true;
  if (typeof DOMException !== "undefined" && error instanceof DOMException) return true;
  return typeof AggregateError !== "undefined" && error instanceof AggregateError;
}

/** Sorts a thrown value: words Commons wrote for people, a request that never arrived, or a driver's, parser's or runtime's own text. */
export function errorKind(error: unknown): ErrorKind {
  if (!(error instanceof Error) || typeof error.message !== "string" || !error.message.trim()) return "technical";
  const message = error.message;
  if (NETWORK_MESSAGE.test(message.trimStart())) return "network";
  if (isBuiltInTechnicalError(error)) return "technical";
  if (TECHNICAL_NAMES.has(error.name)) return "technical";
  if (Object.prototype.hasOwnProperty.call(error, "issues") && Array.isArray((error as { issues?: unknown }).issues)) return "technical";
  if (TECHNICAL_PROPERTIES.some((property) => Object.prototype.hasOwnProperty.call(error, property))) return "technical";
  if (message.startsWith("Failed query:") || message.includes("\n    at ")) return "technical";
  return "person";
}

/** What to show a person in the browser when something throws. Only words Commons wrote pass through. */
export function personFacingError(error: unknown, fallback: string): string {
  const kind = errorKind(error);
  if (kind === "person") return (error as Error).message;
  if (kind === "network") return CONNECTION_ERROR_MESSAGE;
  return fallback;
}
