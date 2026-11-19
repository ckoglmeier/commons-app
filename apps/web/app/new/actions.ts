"use server";

import { newTripOpensCoordinator } from "@/lib/server/event-creation";

/** Server-resolved: lets the creation flow choose Coordinator or the Trip page for a trip it just created. */
export async function tripOpensCoordinator(tripId: string): Promise<boolean> {
  if (typeof tripId !== "string" || tripId.length > 64) return false;
  try { return await newTripOpensCoordinator(tripId); } catch { return false; }
}
