import { loadCommonsSnapshot } from "@/lib/server/commons";
import { createCommonsStateRouteHandler } from "@/lib/commons-state-route";

export const GET = createCommonsStateRouteHandler({
  loadSnapshot: loadCommonsSnapshot,
});
