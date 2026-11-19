import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TripsIndex } from "./trips-index";

Object.assign(globalThis, { React });

test("the coastal homepage keeps real authentication and lets any signed-in account start a trip", async () => {
  const source = await readFile(new URL("./trips-index.tsx", import.meta.url), "utf8");
  assert.match(source, /<span>Group travel<\/span>\{" "\}<span>with less group work\.<\/span>/);
  assert.match(source, /signedIn \? "\/trips" : "\/sign-in\?next=%2Ftrips&intent=invited"/);
  assert.match(source, /href="\/sign-in\?next=%2Fnew&intent=create"/);
  assert.doesNotMatch(source, /creationAccess|betaAccessHref|Request access|access=request/);
  assert.doesNotMatch(source, /View sample trip|homepage-sample/);
  assert.match(source, /src="\/covers\/coast.svg" alt=""/);
  assert.doesNotMatch(source, /brand-exploration|\.png" alt="" fill sizes="100vw"/);
});

test("signed-in homepage and event index offer a new trip without any access request", () => {
  const props = { memberships: [], signedIn: true, canSignOut: true, accountInitials: "QA" };
  const home = renderToStaticMarkup(createElement(TripsIndex, { ...props, publicPage: true }));
  assert.match(home, /Open your trips/);
  assert.match(home, /href="\/new"/);
  assert.match(home, /Start a trip/);
  assert.doesNotMatch(home, /View request|Request access/);
  const index = renderToStaticMarkup(createElement(TripsIndex, props));
  assert.match(index, /Your trips/);
  assert.match(index, /cm-wordmark/);
  assert.doesNotMatch(index, /homepage-coast/);
});
