import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

type VercelConfig = { git?: unknown; crons?: Array<{ path?: string; schedule?: string }>; buildCommand?: string };
const config = async () => JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8")) as VercelConfig;

test("one daily job fits the Vercel Hobby plan", async () => {
  const { crons, git } = await config();
  assert.equal(git, undefined, "no branch rules from the original project");
  assert.deepEqual(crons, [{ path: "/api/internal/daily/", schedule: "0 16 * * *" }]);
  for (const cron of crons ?? []) {
    const [minute, hour, ...rest] = cron.schedule!.split(" ");
    assert.match(minute!, /^\d+$/); assert.match(hour!, /^\d+$/, "at most once a day");
    assert.deepEqual(rest, ["*", "*", "*"]);
  }
});

test("each deploy migrates the database before building", async () => {
  const { buildCommand } = await config();
  assert.match(buildCommand ?? "", /db:migrate[\s\S]*npm run build -w @commons\/web/);
});
