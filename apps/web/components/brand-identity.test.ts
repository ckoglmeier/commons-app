import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TripsIndex } from "./trips-index";

Object.assign(globalThis, { React });

test("the coastal homepage keeps real authentication and beta gates", async () => {
  const source = await readFile(new URL("./trips-index.tsx", import.meta.url), "utf8");
  assert.match(source, /<span>Group travel<\/span>\{" "\}<span>with less group work\.<\/span>/);
  assert.match(source, /signedIn \? "\/trips" : "\/sign-in\?next=%2Ftrips&intent=invited"/);
  assert.match(source, /creationAccessAllowed \? "\/new" : betaAccessHref/);
  assert.match(source, /creationAccessStatus === "requested"/);
  assert.doesNotMatch(source, /View sample trip|homepage-sample/);
  assert.match(source, /src="\/brand\/coast.webp" alt=""/);
  assert.doesNotMatch(source, /brand-exploration|\.png" alt="" fill sizes="100vw"/);
});

test("signed-in homepage and event index keep approval separate from account access", () => {
  const props = { memberships: [], signedIn: true, canSignOut: true, accountInitials: "QA" };
  const pending = renderToStaticMarkup(createElement(TripsIndex, { ...props, publicPage: true, creationAccessStatus: "requested" }));
  assert.match(pending, /Open your trips/);
  assert.match(pending, /View request/);
  assert.doesNotMatch(pending, /Start a trip/);
  const approved = renderToStaticMarkup(createElement(TripsIndex, { ...props, publicPage: true, creationAccessAllowed: true }));
  assert.match(approved, /href="\/new"/);
  assert.match(approved, /Start a trip/);
  const index = renderToStaticMarkup(createElement(TripsIndex, props));
  assert.match(index, /Your trips/);
  assert.match(index, /cm-wordmark/);
  assert.doesNotMatch(index, /homepage-coast/);
});
