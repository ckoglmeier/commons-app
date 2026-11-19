import test from "node:test";
import assert from "node:assert/strict";
import { syntheticDraft } from "../../../packages/contracts/src/fixtures/research-itinerary";
import { undoItineraryRevision, itineraryParticipantDraft, validateItineraryContent } from "@commons/contracts";
import { ItineraryDocumentAutosave, type DocumentSave, type DocumentState } from "./itinerary-document-autosave";
const initial = (): DocumentState => ({ draft: syntheticDraft(), turnId: crypto.randomUUID() });
const receipt = (base: DocumentState, request: DocumentSave): DocumentState => ({ turnId: request.turnId, draft: { ...base.draft, version: request.expectedVersion + 1, content: structuredClone(request.content) } });
test("serialized saves retain text typed in flight and acknowledge only their captured content", async () => {
  const base = initial(), calls: DocumentSave[] = [], pending: Array<(value: DocumentState) => void> = [];
  let recovery: string | null = null;
  const editor = new ItineraryDocumentAutosave(base, request => { calls.push(request); return new Promise(resolve => pending.push(resolve)); }, () => {}, value => { recovery = value; });
  editor.edit({ ...editor.content, opening: "First paragraph" });
  const saved = editor.flush(); assert.equal(calls.length, 1);
  editor.edit({ ...editor.content, opening: "Paragraph typed during the save" });
  assert.equal(editor.flush(), saved, "one serialization queue");
  pending[0](receipt(base, calls[0])); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 2); assert.equal(calls[1].expectedVersion, 2);
  assert.equal(editor.content.opening, "Paragraph typed during the save");
  pending[1](receipt(base, calls[1])); await saved;
  assert.equal(editor.base.draft.version, 3); assert.equal(editor.status, "saved"); assert.equal(recovery, null);
});
test("failed/uncertain saves preserve recovery and replay the same command after reload", async () => {
  const base = initial(), calls: DocumentSave[] = []; let recovery: string | null = null;
  const editor = new ItineraryDocumentAutosave(base, async request => { calls.push(request); throw new Error("Connection lost"); }, () => {}, value => { recovery = value; });
  editor.edit({ ...editor.content, opening: "Keep this paragraph" }); await assert.rejects(editor.flush());
  assert.equal(editor.status, "error"); assert.ok(recovery);
  const restored = new ItineraryDocumentAutosave(base, async request => { calls.push(request); return receipt(base, request); }, () => {}, () => {}, recovery);
  assert.equal(restored.content.opening, "Keep this paragraph"); await restored.flush();
  assert.equal(calls.length, 2); assert.deepEqual(calls[1], calls[0]);
});
test("reload recognizes a committed uncertain command without a duplicate version", async () => {
  const base = initial(); let recovery: string | null = null, committed: DocumentState | null = null;
  const editor = new ItineraryDocumentAutosave(base, async request => { committed = receipt(base, request); throw new Error("Response lost"); }, () => {}, value => { recovery = value; });
  editor.edit({ ...editor.content, opening: "Already committed" }); await assert.rejects(editor.flush());
  let writes = 0;
  const restored = new ItineraryDocumentAutosave(committed!, async () => { writes++; throw new Error(); }, () => {}, () => {}, recovery);
  await restored.flush(); assert.equal(writes, 0); assert.equal(restored.status, "saved");
});
test("stale external versions preserve local work and explicitly reconcile unrelated fields", async () => {
  const base = initial(), editor = new ItineraryDocumentAutosave(base, async request => receipt(base, request), () => {}, () => {});
  editor.edit({ ...editor.content, opening: "My opening" });
  editor.receive({ ...base, draft: { ...base.draft, version: 2, content: { ...base.draft.content, title: "Another organizer's title" } } });
  assert.equal(editor.status, "conflict"); await assert.rejects(editor.flush());
  assert.equal(editor.content.opening, "My opening"); editor.reconcile(); await editor.flush();
  assert.equal(editor.content.title, "Another organizer's title"); assert.equal(editor.content.opening, "My opening");
});
test("conflicting field changes cannot be reconciled over another organizer", () => {
  const base = initial(), editor = new ItineraryDocumentAutosave(base, async request => receipt(base, request), () => {}, () => {});
  editor.edit({ ...editor.content, title: "My title" }); editor.receive({ ...base, draft: { ...base.draft, version: 2, content: { ...base.draft.content, title: "Their title" } } });
  assert.throws(() => editor.reconcile(), /changed again/); assert.equal(editor.content.title, "My title");
});
test("unverified receipts never report Saved or clear local text", async () => {
  const base = initial(), editor = new ItineraryDocumentAutosave(base, async () => base, () => {}, () => {});
  editor.edit({ ...editor.content, opening: "Never lose this" }); await assert.rejects(editor.flush(), /verified/);
  assert.equal(editor.status, "error"); assert.equal(editor.content.opening, "Never lose this"); assert.ok(editor.pending);
});
test("temporary invalid typing recovers after correction instead of trapping an invalid retry", async () => {
  const base = initial(), editor = new ItineraryDocumentAutosave(base, async request => receipt(base, request), () => {}, () => {});
  editor.edit({ ...editor.content, title: "" }); await assert.rejects(editor.flush());
  editor.edit({ ...editor.content, title: "A valid title  " }); await editor.flush();
  assert.equal(editor.status, "saved"); assert.equal(editor.content.title, "A valid title");
});
test("Undo preserves later edits on other rows and other fields; conflicting same fields fail", () => {
  const before = syntheticDraft().content, after = structuredClone(before);
  after.items[0].title = "Revised dinner";
  const later = structuredClone(after); later.items[0].participantNote = "Later note"; later.items[1].title = "Later winery";
  const undone = undoItineraryRevision(later, before, after);
  assert.equal(undone.items[0].title, before.items[0].title); assert.equal(undone.items[0].participantNote, "Later note"); assert.equal(undone.items[1].title, "Later winery");
  later.items[0].title = "Another revision"; assert.throws(() => undoItineraryRevision(later, before, after), /changed again/);
});
test("deletion Undo restores one stable row and preserves a later addition", () => {
  const before = syntheticDraft().content, after = { ...before, items: before.items.slice(1) }, later = structuredClone(after);
  later.items.push({ ...before.items[0], id: "later-added", title: "New stop" });
  const undone = undoItineraryRevision(later, before, after);
  assert.equal(undone.items[0].id, before.items[0].id); assert.equal(undone.items.at(-1)?.id, "later-added");
  assert.throws(() => undoItineraryRevision(undone, before, after), /changed again/);
});
test("participant projection uses only explicitly public document fields", () => {
  const content = syntheticDraft().content;
  content.opening = "Welcome to the weekend"; content.brief = "PRIVATE_BRIEF"; content.driverBrief = "PRIVATE_DRIVER";
  content.days = [{ day: "2026-11-05", description: "Settle in and enjoy dinner" }];
  content.questions = [{ id: "lunch", prompt: "Where should we have lunch?" }];
  const projected = itineraryParticipantDraft(content, () => crypto.randomUUID());
  assert.equal(projected.intro, content.opening); assert.equal(projected.questions.at(-1)?.required, false);
  assert.match(JSON.stringify(projected), /Settle in and enjoy dinner/); assert.doesNotMatch(JSON.stringify(projected), /PRIVATE_BRIEF|PRIVATE_DRIVER/);
});

test("blank and long openings project without loss and optional questions stay optional", () => {
  for (const opening of ["", "   ", "A".repeat(1500)]) {
    const content = { ...syntheticDraft().content, opening };
    const data = itineraryParticipantDraft(content, () => crypto.randomUUID());
    assert.ok(data.communication!.paragraphs[0].length > 0);
    if (opening.trim()) assert.equal(data.communication!.paragraphs[0], opening);
    assert.ok(data.intro === null || data.intro.length <= 500);
  }
});


test("AM/PM intermediate timing fails locally and correcting noon saves after reload", async () => {
  const base = initial(), calls: DocumentSave[] = [];
  base.draft.content.items[0] = { ...base.draft.content.items[0], time: "11:00", endTime: null };
  let recovery: string | null = null;
  const persist = async (request: DocumentSave) => {
    calls.push(request);
    validateItineraryContent(request.content, base.draft, { privateDocumentEdit: true });
    return receipt(base, request);
  };
  const editor = new ItineraryDocumentAutosave(base, persist, () => {}, value => { recovery = value; });
  const invalid = structuredClone(editor.content); invalid.items[0].endTime = "00:00";
  editor.edit(invalid); await assert.rejects(editor.flush());
  assert.equal(calls.length, 0, "do not freeze an invalid midnight value into a server retry");
  assert.equal(editor.pending, null);
  assert.match(editor.error, /end time|AM\/PM/i);
  assert.equal(editor.content.items[0].endTime, "00:00");
  const restored = new ItineraryDocumentAutosave(base, persist, () => {}, value => { recovery = value; }, recovery);
  assert.equal(restored.content.items[0].endTime, "00:00", "invalid typing is retained rather than silently erased");
  const corrected = structuredClone(restored.content); corrected.items[0].endTime = "12:00";
  restored.edit(corrected); await restored.flush();
  assert.equal(calls.length, 1); assert.equal(calls[0].content.items[0].endTime, "12:00");
  assert.equal(restored.status, "saved"); assert.equal(recovery, null);
  const reloaded = new ItineraryDocumentAutosave(restored.base, persist, () => {}, () => {});
  assert.equal(reloaded.content.items[0].endTime, "12:00");
});

test("a legacy trapped invalid-time request is replaced without dropping the corrected local text", async () => {
  const base = initial(), calls: DocumentSave[] = [];
  base.draft.content.items[0] = { ...base.draft.content.items[0], time: "11:00", endTime: null };
  const invalid = structuredClone(base.draft.content); invalid.items[0].endTime = "00:00";
  const corrected = structuredClone(invalid); corrected.items[0].endTime = "12:00";
  const pending: DocumentSave = { commandId: crypto.randomUUID(), turnId: base.turnId, threadId: base.draft.threadId, documentId: base.draft.id, expectedVersion: base.draft.version, content: invalid };
  const raw = JSON.stringify({ base, content: corrected, pending });
  const restored = new ItineraryDocumentAutosave(base, async request => {
    calls.push(request); validateItineraryContent(request.content, base.draft, { privateDocumentEdit: true }); return receipt(base, request);
  }, () => {}, () => {}, raw);
  await restored.flush();
  assert.equal(restored.status, "saved"); assert.equal(calls.length, 1);
  assert.notEqual(calls[0].commandId, pending.commandId);
  assert.equal(calls[0].content.items[0].endTime, "12:00");
});

test("corrected local timing never replaces an uncertain valid command before its receipt is recovered", async () => {
  const base = initial(), calls: DocumentSave[] = [], committed = new Map<string, DocumentState>();
  base.draft.content.items[0] = { ...base.draft.content.items[0], time: "11:00", endTime: null };
  let server = base;
  const editor = new ItineraryDocumentAutosave(base, async request => {
    calls.push(structuredClone(request));
    const replay = committed.get(request.commandId); if (replay) return replay;
    validateItineraryContent(request.content, server.draft, { privateDocumentEdit: true });
    assert.equal(request.expectedVersion, server.draft.version);
    server = receipt(server, request); committed.set(request.commandId, server);
    if (calls.length === 1) throw new Error("Committed, but response lost");
    return server;
  }, () => {}, () => {});
  const first = structuredClone(editor.content); first.items[0].endTime = "12:00";
  editor.edit(first); await assert.rejects(editor.flush(), /response lost/);
  const corrected = structuredClone(editor.content); corrected.items[0].endTime = "13:00";
  editor.edit(corrected); await editor.flush();
  assert.equal(calls.length, 3); assert.deepEqual(calls[1], calls[0]);
  assert.notEqual(calls[2].commandId, calls[0].commandId);
  assert.equal(server.draft.version, base.draft.version + 2);
  assert.equal(server.draft.content.items[0].endTime, "13:00");
  assert.equal(editor.status, "saved");
});
