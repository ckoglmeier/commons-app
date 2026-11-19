import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { GoalReport } from "@commons/contracts";
import { GoalMainReports } from "./coordinator-goals";

test("main reports date historical requests without repeating their instruction", () => {
  const report: GoalReport = { id: "report", goalId: "goal", goalTitle: "Dinner choices", threadId: "thread", goalRevision: 1, kind: "needs_input", headline: "Dinner choices: Prepare and publish a poll.", detail: "Prepare and publish a poll.", nextAction: "Open task", sources: [], superseded: true, createdAt: "2026-10-01T12:00:00.000Z" };
  const html = renderToStaticMarkup(createElement(GoalMainReports, { reports: [report], onOpen: () => {} }));
  assert.match(html, /Earlier result/);
  assert.match(html, /dateTime="2026-10-01T12:00:00.000Z"/);
  assert.match(html, /UTC/);
  assert.equal(html.split("Prepare and publish a poll.").length - 1, 1);
  assert.match(html, /Open task/);
});
