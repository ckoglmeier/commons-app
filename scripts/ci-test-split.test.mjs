import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { shardCommand } from "./ci-web-test-shard.mjs";

// CI splits `npm test` across parallel jobs. These checks fail if the split could silently stop running something.
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const root = JSON.parse(read("package.json")), workflow = read(".github/workflows/ci.yml");

test("a slice is the web test command with the shard flag ahead of the files", () => {
  assert.equal(shardCommand("X=1 tsx --test --test-concurrency=1 a/*.test.ts", "2/4"), "X=1 tsx --test --test-shard=2/4 --test-concurrency=1 a/*.test.ts");
  for (const bad of [undefined, "", "0/4", "5/4", "2", "a/b", "2/4 "]) assert.throws(() => shardCommand("tsx --test a.test.ts", bad));
  assert.throws(() => shardCommand("tsx a.test.ts", "1/2"), /shape/);
  assert.throws(() => shardCommand("tsx --test --test-shard=1/2 a.test.ts", "1/2"), /shape/);
  // The real script still fits.
  assert.match(shardCommand(JSON.parse(read("apps/web/package.json")).scripts.test, "1/4"), / --test --test-shard=1\/4 /);
});

test("the workflow runs every slice it divides the web tests into", () => {
  const list = /shard: \[([\d, ]+)\]/.exec(workflow), total = /ci-web-test-shard\.mjs \$\{\{ matrix\.shard \}\}\/(\d+)/.exec(workflow);
  assert.ok(list && total, "the web-tests matrix and its command are where this test expects them");
  const shards = list[1].split(",").map(item => Number(item.trim()));
  assert.deepEqual(shards, Array.from({ length: Number(total[1]) }, (_, index) => index + 1));
});

test("every workspace's tests run in exactly one CI job", () => {
  const tested = ["apps", "packages"].flatMap(folder => readdirSync(new URL(`../${folder}/`, import.meta.url)).map(name => `${folder}/${name}/package.json`))
    .filter(path => existsSync(new URL(`../${path}`, import.meta.url))).map(path => JSON.parse(read(path))).filter(pkg => pkg.scripts?.test).map(pkg => pkg.name).sort();
  const core = root.scripts["test:ci:core"];
  const inCore = [...core.matchAll(/-w (\S+)/g)].map(match => match[1]).sort();
  assert.deepEqual([...inCore, "@commons/web"].sort(), tested, "a workspace with tests is in test:ci:core, or is the web app (which runs as slices)");
  // Everything else `npm test` does before the workspaces is in the core job too.
  for (const step of root.scripts["test:production"].split(" && ").filter(step => !step.includes("--workspaces"))) assert.ok(core.includes(step), `${step} runs in test:ci:core`);
  assert.match(workflow, /run: npm run test:ci:core/);
});

test("the required status waits for the web slices", () => {
  assert.match(workflow, /needs: \[changes, tests, web-tests, checks\]/);
  assert.match(workflow, /WEB_TESTS: \$\{\{ needs\.web-tests\.result \}\}/);
});
