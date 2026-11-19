import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CommonsParticipant, CommonsSummary } from "@commons/contracts";
import type { EventView } from "../lib/commons-route";
import { TripApplicationShell, type ShellAccount } from "./trip-application-shell";
import { TripIdentity } from "./trip-identity";

// packages/ui compiles with the classic JSX runtime.
Object.assign(globalThis, { React });

const account: ShellAccount = { signedIn: true, actorName: "Ada Lovelace", actorInitials: "AL", roleLabel: "Organizer", signInHref: "/sign-in?next=%2Fc%2Ftrip", feedbackCommonsSlug: "trip" };

function shell(options: { view?: EventView; account?: ShellAccount; fill?: boolean; inert?: boolean; busy?: boolean; placements?: string[] } = {}) {
  const placements = options.placements ?? [];
  const html = renderToStaticMarkup(createElement(TripApplicationShell, {
    commonsId: "trip",
    view: options.view ?? "home",
    navigate() {},
    tripName: "Cape Cod week",
    identity: (placement: "rail" | "menu"): ReactNode => { placements.push(placement); return createElement("div", { "data-identity": placement }, `identity ${placement}`); },
    account: options.account ?? account,
    fill: options.fill,
    inert: options.inert,
    busy: options.busy,
  } as never, createElement("p", null, "page body")));
  return html;
}

function currentLabels(html: string) {
  // Only the rail navigation: the menu dialog repeats the same links.
  const rail = html.slice(html.indexOf('class="trip-shell__rail"'), html.indexOf("<dialog"));
  return [...rail.matchAll(/<a [^>]*aria-current="page"[^>]*>.*?<span>(.*?)<\/span>/g)].map(match => match[1]);
}

test("renders one main landmark, a skip link, and four destination links in the rail and Menu", () => {
  const html = shell();
  assert.equal((html.match(/<main /g) ?? []).length, 1);
  assert.match(html, /<main id="workspace-content" class="trip-shell__content" tabindex="-1"/);
  assert.match(html, /<a class="skip-link" href="#workspace-content">/);
  const destinations = ["Trip", "Coordinator", "Plan", "Money"];
  for (const nav of html.split('class="trip-shell__nav"').slice(1)) {
    const links = [...nav.slice(0, nav.indexOf("</nav>")).matchAll(/<a [^>]*href="([^"]+)"[^>]*><svg[\s\S]*?<span>(.*?)<\/span>/g)];
    assert.deepEqual(links.map(link => link[2]), destinations);
    assert.ok(links.every(link => link[1].startsWith("/c/trip")), "real hrefs");
  }
  assert.equal((html.match(/trip-shell__nav/g) ?? []).length, 2);
});

test("the active destination follows the view: moments is Trip, logistics is Plan", () => {
  assert.deepEqual(currentLabels(shell({ view: "home" })), ["Trip"]);
  assert.deepEqual(currentLabels(shell({ view: "moments" })), ["Trip"]);
  assert.deepEqual(currentLabels(shell({ view: "coordinator" })), ["Coordinator"]);
  assert.deepEqual(currentLabels(shell({ view: "plan" })), ["Plan"]);
  assert.deepEqual(currentLabels(shell({ view: "logistics" })), ["Plan"]);
  assert.deepEqual(currentLabels(shell({ view: "money" })), ["Money"]);
});

test("Menu button controls a labelled dialog that repeats navigation, identity, Your trips and account", () => {
  const html = shell();
  const controls = html.match(/<button[^>]*class="trip-shell__menu-button"[^>]*>/)?.[0] ?? "";
  const id = controls.match(/aria-controls="([^"]+)"/)?.[1];
  assert.ok(id, "Menu button names the dialog it controls");
  assert.match(controls, /aria-haspopup="dialog"/);
  assert.match(controls, /aria-expanded="false"/);
  assert.match(html, new RegExp(`<dialog id="${id.replace(/[:]/g, "\\$&")}" class="trip-shell__menu" aria-labelledby="[^"]+"`));
  assert.match(html, /<span>Menu<\/span>/);
  const dialog = html.slice(html.indexOf("<dialog"), html.indexOf("</dialog>"));
  assert.match(dialog, /data-identity="menu"/);
  assert.match(dialog, /href="\/trips"/);
  assert.match(dialog, /aria-label="Account"/);
  assert.match(dialog, /Ada Lovelace/);
});

test("the identity slot receives both placements and the rail keeps Your trips and the account foot", () => {
  const placements: string[] = [];
  const html = shell({ placements });
  assert.deepEqual([...placements].sort(), ["menu", "rail"]);
  const rail = html.slice(html.indexOf('class="trip-shell__rail"'), html.indexOf("<dialog"));
  assert.match(rail, /data-identity="rail"/);
  assert.match(rail, /<a class="trip-shell__trips" href="\/trips"[^>]*>[\s\S]*Your trips/);
  assert.match(rail, /account-menu account-menu--rail/);
  assert.match(rail, /account-menu__initials" aria-hidden="true">AL</);
  assert.match(rail, /<strong>Ada Lovelace<\/strong><small>Organizer<\/small>/);
  assert.match(html, /<header class="trip-shell__compact"[^>]*>[\s\S]*Cape Cod week/);
  assert.match(html, /aria-label="Commons homepage" title="Commons homepage" href="\/"/);
});

test("signed-out visitors get a Sign in link instead of an account menu", () => {
  const html = shell({ account: { ...account, signedIn: false, actorName: "Guest", actorInitials: "G", roleLabel: "Traveler" } });
  assert.equal((html.match(/href="\/sign-in\?next=%2Fc%2Ftrip"/g) ?? []).length, 2, "rail foot and Menu");
  assert.doesNotMatch(html, /account-menu--rail|Sign out|auth\/sign-out/);
});

test("fill, inert and busy states are exposed for the lead and styling", () => {
  assert.match(shell({ fill: true }), /<div class="trip-shell" data-fill="true"/);
  assert.doesNotMatch(shell(), /data-fill/);
  const inert = shell({ inert: true });
  assert.equal((inert.match(/ inert=""/g) ?? []).length, 3, "compact header, rail and content are inert");
  assert.equal((inert.match(/aria-hidden="true"[^>]*>/g) ?? []).length >= 3, true);
  assert.doesNotMatch(shell(), / inert=""/);
  const busy = shell({ busy: true });
  assert.match(busy, /class="trip-shell__menu-button"[^>]*disabled=""|disabled=""[^>]*class="trip-shell__menu-button"/);
  assert.match(busy, /aria-busy="true"/);
});

const commons = { id: "trip", name: "Cape Cod week", startsOn: "2026-07-04", endsOn: "2026-07-11", timezone: "America/New_York" } as unknown as CommonsSummary;
const participants = [{ id: "a", displayName: "Ada Lovelace", initials: "AL" }, { id: "b", displayName: "Grace Hopper", initials: "GH" }] as unknown as CommonsParticipant[];
function identity(props: Record<string, unknown> = {}) {
  return renderToStaticMarkup(createElement(TripIdentity, { placement: "rail", commons, meta: "Jul 4 – 11 · Cape Cod", coverImage: null, participants, ...props } as never));
}

test("TripIdentity shows the trip, People count and no actions that were not passed", () => {
  const html = identity();
  assert.match(html, /Cape Cod week/);
  assert.match(html, /Jul 4 – 11 · Cape Cod/);
  assert.match(html, /2 travelers/);
  assert.doesNotMatch(html, /<button/, "no People button, options, walkthrough or conversation without callbacks");
  assert.doesNotMatch(html, /Trip options|Trip context|Trip settings|Change cover|Add cover|\[DEMO\]|Start walkthrough|Group conversation/);
});

test("TripIdentity exposes People and a Trip options menu only for authorized callbacks", () => {
  const people = identity({ openPeople() {} });
  assert.match(people, /<button[^>]*aria-label="People: 2 travelers"/);
  assert.doesNotMatch(people, /Trip options/);
  const full = identity({ openPeople() {}, openCoverPicker() {}, openSettings() {}, contextHref: "/c/trip/context" });
  assert.match(full, /<button[^>]*aria-label="Trip options"[^>]*aria-expanded="false"|<button[^>]*aria-expanded="false"[^>]*aria-label="Trip options"/);
  const solo = identity({ openCoverPicker() {} });
  assert.match(solo, /aria-label="Trip options"/);
});

test("TripIdentity keeps the demo marker without a walkthrough launcher", () => {
  const sample = identity({ demo: true });
  assert.match(sample, /\[DEMO\]/);
  assert.doesNotMatch(sample, /Start walkthrough/);
  assert.match(identity({ groupConversation: { open() {}, detail: "3 messages" } }), /Group conversation[\s\S]*3 messages/);
});
