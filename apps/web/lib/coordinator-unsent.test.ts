import assert from "node:assert/strict";
import test from "node:test";
import { clearUnsentIfSent, readUnsent, transferUnsent, writeUnsent, rememberItineraryPaste, finishSavedItineraryPaste, unsentDestinationFor } from "./coordinator-unsent";

test("artifacts in one conversation share its unsent composer without crossing threads", () => {
  for (const selected of ["thread:main", "draft:poll-draft", "poll:published", "itinerary:document"]) {
    assert.equal(unsentDestinationFor({startingQuestion:false,startingThread:false,selected}, "main"), "thread:main");
  }
  assert.equal(unsentDestinationFor({startingQuestion:false,startingThread:false,selected:"poll:other"}, "other"), "thread:other");
  assert.equal(unsentDestinationFor({startingQuestion:true,startingThread:false,selected:"poll:published"}, "main"), "ask");
  assert.equal(unsentDestinationFor({startingQuestion:false,startingThread:true,selected:"poll:published"}, "main"), "new");
});

function memory() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}

test("handoff preserves exact typed text across reload and isolates actor, trip and destination", () => {
  const storage = memory(), text = "  Dinner → 5?\nKeep & punctuation.  ";
  writeUnsent("trip", "actor", "overview", text, storage);
  assert.equal(transferUnsent("trip", "actor", "overview", "thread:main", text, false, storage), "transferred");
  assert.equal(readUnsent("trip", "actor", "thread:main", storage), text);
  assert.equal(readUnsent("trip", "actor", "overview", storage), "");
  for (const [trip, actor, destination] of [["other-trip", "actor", "thread:main"], ["trip", "other-actor", "thread:main"], ["trip", "actor", "new"]] as const) {
    assert.equal(readUnsent(trip, actor, destination, storage), "");
  }
});

test("a conflict keeps both drafts until explicit replacement, including empty Overview entry", () => {
  const storage = memory();
  writeUnsent("trip", "actor", "overview", "Overview text", storage);
  writeUnsent("trip", "actor", "new", "Coordinator text", storage);
  assert.equal(transferUnsent("trip", "actor", "overview", "new", "Overview text", false, storage), "conflict");
  assert.equal(readUnsent("trip", "actor", "overview", storage), "Overview text");
  assert.equal(readUnsent("trip", "actor", "new", storage), "Coordinator text");
  assert.equal(transferUnsent("trip", "actor", "overview", "new", "", false, storage), "transferred");
  assert.equal(readUnsent("trip", "actor", "new", storage), "Coordinator text");
  assert.equal(transferUnsent("trip", "actor", "overview", "new", "Overview text", true, storage), "transferred");
  assert.equal(readUnsent("trip", "actor", "new", storage), "Overview text");
  assert.equal(readUnsent("trip", "actor", "overview", storage), "");
});

test("unavailable or full storage never clears the source", () => {
  const storage = memory();
  writeUnsent("trip", "actor", "overview", "Keep me", storage);
  const full = { ...storage, setItem() { throw new Error("Quota exceeded"); } };
  assert.equal(transferUnsent("trip", "actor", "overview", "new", "Keep me", false, full), "unavailable");
  assert.equal(readUnsent("trip", "actor", "overview", storage), "Keep me");
  assert.equal(transferUnsent("trip", "actor", "overview", "new", "Keep me", false, null), "unavailable");
  // A concurrent edit is retained; only the exact confirmed text is cleared.
  clearUnsentIfSent("trip", "actor", "overview", "Old text", storage);
  assert.equal(readUnsent("trip", "actor", "overview", storage), "Keep me");
});

test("a long pasted itinerary survives reload without losing its ending",()=>{
  const storage=memory(), source="Thursday: Arrival\n1:12 PM Land at SFO\n"+"Keep this note. ".repeat(200)+"\nFriday: Wineries\n10:00 AM Flowers";
  assert.ok(source.length>1800);
  writeUnsent("trip","actor","thread:main",source,storage);
  assert.equal(readUnsent("trip","actor","thread:main",storage),source);
  clearUnsentIfSent("trip","actor","thread:main",source,storage);
  assert.equal(readUnsent("trip","actor","thread:main",storage),"");
});


test("verified itinerary save after refresh clears only its original actor-scoped paste",()=>{
  const storage=memory(),source="Thursday\n1:12 PM Land at SFO\n7:30 PM Dinner";
  writeUnsent("trip","actor","new",source,storage);
  rememberItineraryPaste("trip","actor","draft","new",source,storage);
  assert.equal(finishSavedItineraryPaste("trip","other","draft",source,storage),null);
  assert.equal(finishSavedItineraryPaste("other","actor","draft",source,storage),null);
  assert.equal(finishSavedItineraryPaste("trip","actor","draft","Different source",storage),null);
  assert.equal(readUnsent("trip","actor","new",storage),source);
  writeUnsent("trip","actor","new","A newer question",storage);
  assert.equal(finishSavedItineraryPaste("trip","actor","draft",source,storage),"new");
  assert.equal(readUnsent("trip","actor","new",storage),"A newer question");
  writeUnsent("trip","actor","new",source,storage);
  rememberItineraryPaste("trip","actor","draft","new",source,storage);
  assert.equal(finishSavedItineraryPaste("trip","actor","draft",source,storage),"new");
  assert.equal(readUnsent("trip","actor","new",storage),"");
});
