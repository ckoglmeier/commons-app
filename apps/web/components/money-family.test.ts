import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("cost entry separates planned status from balance allocation", async () => {
  const source = await readFile(new URL("./commons-app.tsx", import.meta.url), "utf8");

  assert.match(source, /Is this planned or already paid\?/);
  const budgetChoice = source.indexOf(">Budget</button>");
  const recordedChoice = source.indexOf(">Recorded</button>", budgetChoice);
  assert.ok(budgetChoice > -1 && recordedChoice > budgetChoice);
  assert.match(source, /Should this create balances\?/);
  const noAllocationChoice = source.indexOf(">No allocation</button>");
  const allocateChoice = source.indexOf(">Allocate balances</button>", noAllocationChoice);
  assert.ok(noAllocationChoice > -1 && allocateChoice > noAllocationChoice);
  assert.match(source, /Mark as recorded/);
  assert.match(source, /startAsRecorded/);
  assert.doesNotMatch(source, />Allocate balances<\/button>}<button[^>]+>Budget only<\/button>/);
});

test("Money exposes the family-trip setting and confirms hidden balances", async () => {
  const [source, css] = await Promise.all([
    readFile(new URL("./commons-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(source, /Money settings/);
  assert.match(source, /This is a family trip/);
  assert.match(source, /Family trip · Balances off/);
  assert.match(source, /Turning this on hides those balances/);
  assert.match(source, /Turn balances off/);
  assert.match(source, /The expenses and splits stay saved/);
  assert.match(source, /commons\.balancesDisabled\s*\?\s*`\$\{payerName\} paid`/);
  assert.match(source, /balancesDisabled\s*\?\s*null/);
  assert.match(source, /balancesDisabled\s*\?\s*`\$\{expense\.paidByName\} paid\.`/);
  assert.doesNotMatch(source, /paid · No balances|paid\. No balances\./);
  assert.match(source, /showAllocation = expense\.balanceMode !== "budget_only" && !balancesDisabled/);
  assert.match(source, /!balancesDisabled \? <div><dt>Split<\/dt>/);
  assert.match(source, /This removes \$\{formatMoney\(expense\.amountCents, expense\.currency\)\} from recorded trip spending\./);
  assert.match(css, /\.money-settings-link \{[^}]*min-height: var\(--cm-touch-target\)/);
  assert.match(css, /\.money-family-setting \{[^}]*min-height: 5\.25rem/);
});
