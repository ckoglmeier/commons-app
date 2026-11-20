import "server-only";
import { errorKind } from "../person-facing-error";

/** The error text for a JSON response. A driver's or runtime's own words never leave the server; they go to the server log instead. */
export function errorTextForResponse(error: unknown, fallback: string): string {
  if (errorKind(error) === "person") return (error as Error).message;
  // The person sees the fallback; whoever runs this copy finds the real cause in the server log.
  console.error("Commons request failed:", error);
  return fallback;
}
