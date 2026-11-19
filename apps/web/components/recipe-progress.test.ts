import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GoalStages } from "./goal-stages";

test("stage presentation has three accessible controls and no implicit completion or old progress rail", () => {
  const html = renderToStaticMarkup(createElement(GoalStages, { initialStage: "decide", build: "Editable goal", share: "Saved link", decide: "Approval and separate Update the trip" }));
  assert.equal((html.match(/aria-controls=/g) ?? []).length, 3);
  assert.equal((html.match(/aria-expanded="true"/g) ?? []).length, 1);
  assert.match(html, /Approval and separate Update the trip/);
  assert.doesNotMatch(html, /data-state|Now|Next|Progress/);
});
