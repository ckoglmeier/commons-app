import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

/*
 * Inventory guard for BR-03 "retire unnecessary broad research/chat/voice jobs and endpoints". Every state-changing handler
 * under the Coordinator API tree must call the capability guard before reading its body, so a beta trip (coordinator: false)
 * cannot reach inference, research or voice. Reads of saved history are the documented exceptions. docs/BETA-COORDINATION-STATUS.md
 * lists the same inventory; a new unguarded Coordinator route fails here instead of silently running for beta trips.
 */
const root = new URL("../../app/api/v1", import.meta.url).pathname;

async function routes(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => entry.isDirectory() ? routes(join(directory, entry.name)) : entry.name === "route.ts" ? [join(directory, entry.name)] : []));
  return nested.flat();
}

/** GET handlers that only read saved history stay available on every trip. */
const READ_ONLY = new Set(["coordinator/itinerary-history", "coordinator/itinerary-export", "coordinator/turns/[commandId]"]);
/** Guarded with the "goals" capability: direct goal work, no conversation, research or model call. */
const DIRECT = ["recipes", "goals/[goalId]/questions", "coordinator/goals"];

test("every state-changing Coordinator handler is capability-guarded; direct goal handlers use the goals capability", async () => {
  const files = (await routes(join(root, "commons/[slug]/coordinator"))).concat(await routes(join(root, "commons/[slug]/recipes")), await routes(join(root, "commons/[slug]/goals")));
  const guarded: string[] = [], direct: string[] = [];
  for (const file of files.sort()) {
    const name = relative(join(root, "commons/[slug]"), file).replace(/\/route\.ts$/, "");
    if (READ_ONLY.has(name)) continue;
    const source = await readFile(file, "utf8");
    const mutating = [...source.matchAll(/export async function (POST|PATCH|PUT|DELETE)\b/g)].map(match => match[1]);
    if (!mutating.length) continue;
    const reexport = /export \{[^}]*\} from "\.\.\/coordinator\/goals\/route"/.test(source);
    if (reexport) { direct.push(`${name} (re-exports coordinator/goals)`); continue; }
    assert.match(source, /agentCapabilityBlock|capabilityUnavailableResponse/, `${name} must refuse beta and free trips before any inference`);
    for (const method of mutating) {
      const handler = source.slice(source.indexOf(`export async function ${method}`)).split(/\nexport /)[0];
      if (name === "coordinator/settings") continue; // GET reads; the write branch guards inline.
      assert.match(handler.slice(0, 400), /agentCapabilityBlock\(/, `${name} ${method} guards before reading the body`);
      // Dismissing a Plan-idea task suggestion belongs to the Coordinator's suggestions, so it stays Coordinator-only.
      const isDirect = DIRECT.some(prefix => name.startsWith(prefix)) && !(name === "coordinator/goals" && method === "PATCH");
      (isDirect ? direct : guarded).push(`${name} ${method}`);
      if (isDirect) assert.match(handler.slice(0, 400), /"goals"/, `${name} ${method} uses the goals capability`);
      else assert.doesNotMatch(handler.slice(0, 400), /"goals"/, `${name} ${method} needs the general Coordinator`);
    }
  }
  assert.ok(guarded.length >= 20, `the inventory found ${guarded.length} Coordinator-only handlers`);
  assert.ok(direct.length >= 9, `the inventory found ${direct.length} direct goal handlers`);
  console.info(`Coordinator-only handlers refused for beta trips (${guarded.length}):\n  ${guarded.join("\n  ")}\nDirect goal handlers kept (${direct.length}):\n  ${direct.join("\n  ")}`);
});
