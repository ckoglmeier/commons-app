// Runs one slice of the web test suite: `node scripts/ci-web-test-shard.mjs 2/4`.
//
// CI runs the web tests as several jobs at once, each with its own disposable database, because one at a time they take about 13 minutes.
// The file list is not repeated here: this takes the `test` script from apps/web/package.json and adds Node's own `--test-shard`, which
// splits the sorted file list so that every file lands in exactly one slice. `npm test` is untouched and still runs everything.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { delimiter } from "node:path";
import { fileURLToPath } from "node:url";

/** The web test command for one slice. The shard flag must come before the file list, or Node treats it as another file to run. */
export function shardCommand(testScript, shard) {
  const match = /^(\d+)\/(\d+)$/.exec(shard ?? "");
  if (!match || Number(match[1]) < 1 || Number(match[1]) > Number(match[2])) throw new Error(`Shard must look like 2/4, got "${shard}".`);
  if (!testScript.includes(" --test ") || testScript.includes("--test-shard")) throw new Error("The web test script no longer has the shape this expects (`tsx --test ...` with no shard).");
  return testScript.replace(" --test ", ` --test --test-shard=${shard} `);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const web = new URL("../apps/web/", import.meta.url), root = new URL("../", import.meta.url);
  const command = shardCommand(JSON.parse(readFileSync(new URL("package.json", web), "utf8")).scripts.test, process.argv[2]);
  console.log(`> ${command}`);
  // The same PATH `npm run` would give the script, so `tsx` resolves.
  const bins = [new URL("node_modules/.bin", web), new URL("node_modules/.bin", root)].map(url => fileURLToPath(url));
  const result = spawnSync(command, { shell: true, cwd: fileURLToPath(web), stdio: "inherit", env: { ...process.env, PATH: [...bins, process.env.PATH].join(delimiter) } });
  process.exit(result.status ?? 1);
}
