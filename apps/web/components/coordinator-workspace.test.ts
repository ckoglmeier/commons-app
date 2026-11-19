import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { askEntryHref } from "../lib/ask-route";

test("publishing is explicit approval and sharing stays copy-based", async () => {
  const source = await readFile(new URL("./coordinator-share.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /shareApproved|I approve this message and poll for sharing/);
  assert.match(source, /publicationApproval: \{ approved: true, access \}/);
  assert.match(source, /Copy for email/);
  assert.match(source, /Copy for text/);
  assert.match(source, /Copy link/);
  assert.doesNotMatch(source, /Send as email from Commons|Choose recipients/);
  assert.match(source, /Choose how to share it/);
});

test("Trip Home routes organizer Ask through the pilot and preserves the existing guided flow otherwise", async () => {
  const source = await readFile(new URL("./coordinator-workspace.tsx", import.meta.url), "utf8");
  const home = await readFile(new URL("./home-dashboard.tsx", import.meta.url), "utf8");
  const app = await readFile(new URL("./commons-app.tsx", import.meta.url), "utf8");
  // The behavior (explicit ask_group action, no /drafts request, draft created inside the thread) is covered in coordinator-turn-ui.test.ts.
  assert.match(source, /What are you trying to ask the group\?/);
  assert.match(source, /onClick=\{\(\) => startQuestionTopic\(\)\}>Ask the group<\/button>/);
  assert.match(home, /askEntryHref\(commons\.id, canAskGroup, recipesAvailable, coordinatorAvailable\)/);
  assert.match(home, /href=\{askHref\}><QuestionIcon \/><span>Ask the group<\/span>/);
  assert.match(app, /canAskGroup=\{canManageTrip\} recipesAvailable=\{Boolean\(organizerWorkspace\?\.recipesEnabled\)(?: \|\| Boolean\(directGoals\))?\}/);
  assert.equal(askEntryHref("trip-id", true, true), "/c/trip-id/ask", "pilot organizer entry opens the consolidated Ask workspace");
  assert.equal(askEntryHref("trip-id", true, false), "/c/trip-id/coordinator?ask=1", "outside the pilot the existing guided conversation remains available");
  assert.equal(askEntryHref("trip-id", false, true), undefined, "participants do not get the organizer Ask entry");
});

test("the standalone workspace keeps the global header; trip screens use the persistent shell", async () => {
  const workspace = await readFile(new URL("./coordinator-workspace.tsx", import.meta.url), "utf8");
  const app = await readFile(new URL("./commons-app.tsx", import.meta.url), "utf8");
  const navigation = await readFile(new URL("./global-navigation.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  // The standalone workspace keeps the global header; trip screens use the persistent shell instead of a second header.
  assert.match(workspace, /import \{ GlobalNavigation \} from "\.\/global-navigation"/);
  assert.doesNotMatch(app, /GlobalNavigation/);
  assert.match(app, /<TripApplicationShell /);
  assert.doesNotMatch(workspace, /PollWorkspaceHeader/);
  assert.doesNotMatch(workspace, /className="mobile-nav"/);
  assert.match(navigation, /className="global-account-action"/);
  assert.doesNotMatch(styles, /data-account-in-navigation="true"\] \.trip-menu-toggle \{ display: inline-flex/);
  assert.match(styles, /@media \(min-width: 1100px\) \{ \.trip-menu-toggle \{ display: none; \} \}/);
  assert.match(styles, /global-nav\[data-account-in-navigation="true"\] \.global-account-action \{ display: block; \}/);
});

test("working draft stays mounted beside the accessible coordinator composer", async () => {
  const source = await readFile(new URL("./coordinator-workspace.tsx", import.meta.url), "utf8");
  assert.match(source, /<CoordinatorReview inline/);
  assert.match(source, /<aside[^>]*ref=\{draftDetails\}/);
  assert.doesNotMatch(source, /<details ref=\{draftDetails\}/);
  assert.match(source, /aria-label="Message your coordinator"/);
  assert.match(source, /`Send message to \$\{coordinatorName\}`/);
  assert.match(source, /<CoordinatorLiveConversation available=\{voiceAvailable\}/);
});

// Voice delegation, session binding and approval boundaries are covered by behavior tests (coordinator-live-conversation.test.ts, coordinator-turn-ui.test.ts,
// lib/server/coordinator-live-route.test.ts), not by source-text assertions.

test("saving direct edits keeps the editor stable for continued work", async () => {
  const source = await readFile(new URL("./coordinator-review.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /action === "save"\) setEditing\(false\)/);
  assert.match(source, /dirty \? "Cancel edits" : "Done editing"/);
});

test("published contexts return to the visible share flow instead of the conversation footer", async () => {
  const workspace = await readFile(new URL("./coordinator-workspace.tsx", import.meta.url), "utf8");
  const sharing = await readFile(new URL("./coordinator-share.tsx", import.meta.url), "utf8");
  assert.match(workspace, /scroller\.scrollTop = scroller\.scrollHeight/, "opening a place starts at its latest message, in whichever element scrolls");
  assert.doesNotMatch(workspace, /artifact\.publishedPollId \? "Share poll" : "Review working draft"/);
  assert.match(sharing, /Choose how to share it/);
  assert.match(sharing, /review-share-choices/);
  assert.match(sharing, /Copy for email/);
  assert.match(sharing, /Copy link/);
  assert.match(sharing, /Copy for text/);
  assert.doesNotMatch(sharing, /Send as email from Commons/);
});

test("published polls use plain lifecycle copy and hide empty results", async () => {
  const review = await readFile(new URL("./coordinator-review.tsx", import.meta.url), "utf8");
  const workspace = await readFile(new URL("./coordinator-workspace.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(review, /Published · Immutable/);
  assert.match(review, /View poll and message/);
  assert.match(review, /Hide poll and message/);
  assert.match(workspace, /selectedPoll && selectedPoll\.responseCount > 0/);
});

test("coordinator composer follows the scrollable history in keyboard and visual order", async () => {
  const source = await readFile(new URL("./coordinator-workspace.tsx", import.meta.url), "utf8");
  assert.ok(source.indexOf('aria-label="Conversation history"') < source.indexOf("{composerForm}"));
  assert.ok(source.indexOf("Load earlier messages") < source.indexOf("{contextTurns.map"));
  assert.match(source, /workspaceContextTurns\(effectiveSelected, thread\)\.reverse\(\)/);
  assert.match(source, /scroller\.scrollTop = scroller\.scrollHeight/);
  // Load earlier keeps its anchor on whatever really scrolls: the message list (legacy) or, on short persistent layouts, the conversation slot.
  assert.match(source, /const scroller = persistent \? conversationScroller\(\) : messages\.current;[\s\S]*historyAnchor\.current\.top \+ scroller\.scrollHeight - historyAnchor\.current\.height/);
});

test("resolved coordinator proposals collapse while pending proposals remain actionable", async () => {
  const source = await readFile(new URL("./coordinator-workspace.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(!pending\) return <details className="workspace-proposal workspace-proposal--resolved">/);
  assert.match(source, /View update/);
  assert.match(source, /proposal\.state === "applied" \? "Applied to draft · Not shared" : "Kept current draft"/);
  assert.match(source, /return <section className="workspace-proposal">/);
  assert.match(source, /Apply to draft/);
  assert.match(source, /Keep current/);
});

test("Trip board starts a new durable coordinator topic and names saved exchanges clearly", async () => {
  const source = await readFile(new URL("./coordinator-workspace.tsx", import.meta.url), "utf8");
  assert.match(source, /className="workspace-start-thread" aria-label="Start something new"/);
  assert.match(source, />\+<\/span> New thread<\/button>/);
  assert.doesNotMatch(source, /Choose something to work on\./);
  assert.doesNotMatch(source, /<h2>Trip board<\/h2>/);
  // New thread is an ordinary conversation (behavior: coordinator-turn-ui.test.ts "Start a new text restaurant topic").
  assert.match(source, /startNewConversation\(\)/);
  assert.match(source, /activeGoals\.map\(goal => goalThread\(goal\)\)/);
  assert.doesNotMatch(source, /The whole trip|General conversation|boardThread\("trip"/);
  assert.match(source, />Keep as a Trip board topic<\/button>/);
  assert.doesNotMatch(source, />Save to Trip board<\/button>/);
});

test("saved Trip board topics can be archived and restored from the rail", async () => {
  const workspace = await readFile(new URL("./coordinator-workspace.tsx", import.meta.url), "utf8");
  const contracts = await readFile(new URL("../../../packages/contracts/src/coordinator.ts", import.meta.url), "utf8");
  const repository = await readFile(new URL("../../../packages/database/src/coordinator-repository.ts", import.meta.url), "utf8");

  assert.match(workspace, /aria-label=\{`\$\{archived \? "Restore" : "Archive"\} \$\{turn\.userText\}`\}/);
  assert.match(workspace, /`Archived · \$\{archiveCount\}`/);
  assert.match(workspace, /archived \? "unarchive" : "archive"/);
  assert.match(workspace, /resourceType: "draft" \| "poll"/);
  assert.match(contracts, /"archive", "unarchive"/);
  assert.match(repository, /workspace\.archivedAt = new Date\(\)\.toISOString\(\)/);
  assert.match(repository, /delete workspace\.archivedAt/);
});

test("bottom composer reserves space, respects safe areas and remains independent of history", async () => {
  const css = await readFile(new URL("./coordinator-workspace.css", import.meta.url), "utf8");
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /\.workspace-messages \{ flex: 1; overflow-y: auto/);
  assert.match(css, /\.workspace-chat \.review-composer \{ position: relative; flex-shrink: 0; max-height: 38%; min-height: 0/);
  assert.match(css, /\.workspace-chat \.workspace-input-bar textarea \{[^}]*min-height: 44px/);
  assert.match(css, /@media \(min-height: 650px\)/);
});

test("desktop Trip board can collapse without removing its restore control", async () => {
  const source = await readFile(new URL("./coordinator-workspace.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("./coordinator-workspace.css", import.meta.url), "utf8");
  assert.match(source, /data-board=\{navigationCollapsed \? "collapsed" : "expanded"\}/);
  assert.match(source, /aria-label=\{navigationCollapsed \? \(continuity \|\| goalsEnabled \? "Show navigation" : "Show Trip board"\) : \(continuity \|\| goalsEnabled \? "Hide navigation" : "Hide Trip board"\)\}/);
  assert.match(source, /localStorage\.setItem\(`commons:\$\{slug\}:workspace-board`/);
  assert.match(css, /\.workspace-columns\[data-board="collapsed"\] \{ grid-template-columns: 56px minmax\(340px, 1fr\) minmax\(360px, \.9fr\); \}/);
  assert.match(css, /\.workspace-collapse \{ display: grid; \}/);
});

test("production workspace separates board, conversation and working material", async () => {
  const workspace = await readFile(new URL("./coordinator-workspace.tsx", import.meta.url), "utf8");
  const parts = await readFile(new URL("./coordinator-turn-parts.tsx", import.meta.url), "utf8");
  const prototype = await readFile(new URL("../app/prototype/coordinator-workspace/page.tsx", import.meta.url), "utf8");
  assert.match(workspace, /className="workspace-work workspace-panel"/);
  assert.match(workspace, /data-work=\{workCollapsed \? "collapsed" : "expanded"\}/);
  // The label of the third switch button lives in `workLabel` (shared with the persistent layout's restore action); legacy markup is unchanged.
  assert.match(workspace, /"Tasks" : "Trip board".*Conversation<\/button>.*\{workLabel\}<\/button>/s);
  assert.match(workspace, /const workLabel = .*"Poll draft"/s);
  assert.match(parts, /run\.sources\.map/);
  assert.doesNotMatch(workspace, /workspace-open-editor/);
  assert.match(workspace, /workspace-context-controls/);
  assert.match(workspace, /className="workspace-work-collapse workspace-work-toggle"/);
  assert.match(workspace, /aria-controls="workspace-working-pane" aria-expanded=\{pane === "work"\}/);
  assert.match(prototype, /prototypeInspector/);
  assert.doesNotMatch(await readFile(new URL("../app/c/[slug]/coordinator/page.tsx", import.meta.url), "utf8"), /prototypeInspector/);
});

test("completed research opens the evidence rail for sources and future browser work", async () => {
  const workspace = await readFile(new URL("./coordinator-workspace.tsx", import.meta.url), "utf8");
  const parts = await readFile(new URL("./coordinator-turn-parts.tsx", import.meta.url), "utf8");
  // Research by text and by voice is covered by behavior tests in coordinator-turn-ui.test.ts.
  assert.match(workspace, /item\.kind === "research_run"\).*onOrigin\(origin\).*openResearch\(result\.turnId\)/);
  assert.match(workspace, /Research & sources/);
  assert.match(parts, /target="_blank" rel="noreferrer"/);
  assert.match(parts, /research\.sources|run\.sources/);
});

test("coordinator inference keeps draft and research work inside the selected goal", async () => {
  const workspace = await readFile(new URL("./coordinator-workspace.tsx", import.meta.url), "utf8");
  // Thread turns run through the turn service (behavior covered in lib/server/coordinator-turn-service.test.ts).
  const service = await readFile(new URL("../lib/server/coordinator-turn-service.ts", import.meta.url), "utf8");
  assert.match(workspace, /Research & sources/);
  assert.match(service, /contextKey: `thread:\$\{turn\.threadId\}`/);
});

test("Plan ideas can become linked goal threads without duplicating or scheduling them", async () => {
  const workspace = await readFile(new URL("./coordinator-workspace.tsx", import.meta.url), "utf8");
  assert.match(workspace, /Turn an idea into something to work through/);
  assert.match(workspace, /"Discuss with Coordinator" : "Start a thread"/);
  assert.match(workspace, /itineraryItemId: idea\.id, action: "link"/);
  assert.match(workspace, /Linking an activity does not schedule or approve it/);
});
