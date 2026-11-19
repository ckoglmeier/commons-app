import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

// An allowlist: unknown paths, missing history, and manual runs get full CI.
export function documentationOnly(paths) {
  return paths.length > 0 && paths.every(path =>
    path === "README.md" || /^docs\/.*\.md$/.test(path));
}

export function requiresCodeChecks({ event, base, head }, diff) {
  if (event === "workflow_dispatch" || !base || !head || /^0+$/.test(base)) return true;
  try {
    // --no-renames includes the old path: moving code into docs must run CI.
    const paths = diff(base, head).split("\0").filter(Boolean);
    return !documentationOnly(paths);
  } catch {
    return true;
  }
}

if (process.env.GITHUB_OUTPUT) {
  const code = requiresCodeChecks({ event: process.env.EVENT, base: process.env.BASE, head: process.env.HEAD },
    (base, head) => execFileSync("git", ["diff", "--name-only", "--no-renames", "-z", base, head], { encoding: "utf8" }));
  appendFileSync(process.env.GITHUB_OUTPUT, `code=${code}\n`);
  console.log(code ? "Run all checks" : "Documentation only; expensive checks skipped");
}
