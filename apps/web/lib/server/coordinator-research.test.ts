import test from "node:test";
import assert from "node:assert/strict";
import { publicResearchUrl, researchForCoordinator, type ResearchProvider } from "./coordinator-research";

test("research URL boundary excludes local addresses, credentials and executable links", () => {
  for (const url of ["http://example.com", "https://127.0.0.1", "https://[::1]", "https://localhost", "https://foo.internal", "https://u:p@example.com", "javascript:alert(1)", "https://example.com?api_key=secret"]) assert.equal(publicResearchUrl(url), null, url);
  assert.equal(publicResearchUrl("https://example.com/hotel#rates"), "https://example.com/hotel");
});
test("limits calls, sources and excerpts and ignores unrequested read results", async () => {
  let searches = 0; let reads = 0;
  const provider: ResearchProvider = {
    async search(query, options) { searches++; assert.equal(query, "Sonoma hotels"); assert.equal(options.limit, 5); return Array.from({ length: 10 }, (_, i) => ({ url: `https://example.com/${i}`, title: "Hotel", excerpt: "x".repeat(6000) })); },
    async read(urls) { reads++; assert.equal(urls.length, 3); return [{ url: urls[0], excerpt: "Page evidence" }, { url: "https://unrequested.com", excerpt: "Ignore" }]; },
  };
  const result = await researchForCoordinator("Sonoma hotels", provider);
  assert.equal(searches, 1); assert.equal(reads, 1); assert.equal(result.sources.length, 5);
  assert.equal(result.sources[0].coverage, "page"); assert.equal(result.sources[1].excerpt.length, 5000);
  assert.equal(result.status, "partial"); assert.match(result.limitations.join(" "), /not a booking quote/);
});
test("read failures preserve snippets; caller cancellation never becomes success", async () => {
  const controller = new AbortController();
  const provider: ResearchProvider = { async search() { return [{ url: "https://example.com", title: "Hotel", excerpt: "Snippet" }]; }, async read() { throw new Error("blocked"); } };
  assert.equal((await researchForCoordinator("Hotel", provider)).status, "partial");
  controller.abort();
  await assert.rejects(researchForCoordinator("Hotel", provider, controller.signal));
});
test("deadline bounds a provider that ignores cancellation", async () => {
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const provider: ResearchProvider = { search: () => new Promise(() => {}), async read() { throw new Error("must not read"); } };
    assert.equal((await researchForCoordinator("Hotel", provider, undefined, 10)).status, "unavailable");
  } finally { clearTimeout(keepAlive); }
});

test("reads the selected saved activity website before searching and ignores unrelated returned pages", async () => {
  const reads: string[][] = [];
  let searches = 0;
  const provider: ResearchProvider = {
    async search() { searches++; return []; },
    async read(urls) { reads.push(urls); return [{ url: urls[0], excerpt: "Visitor center closes at 4 PM; grounds close at sunset." }, { url: "https://unrequested.example.org", excerpt: "Ignore this." }]; },
  };
  const result = await researchForCoordinator("Audubon center closing hours", provider, undefined, undefined, [{ url: "https://audubon.example.org/visit", title: "Saved Audubon activity" }]);
  assert.equal(searches, 0);
  assert.deepEqual(reads, [["https://audubon.example.org/visit"]]);
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].coverage, "page");
  assert.match(result.sources[0].excerpt, /4 PM/);
});
test("unreadable saved website falls back to bounded search without exceeding the page allowance", async () => {
  const reads: string[][] = [];
  const provider: ResearchProvider = {
    async search() { return [0, 1, 2, 3].map(i => ({ url: `https://public.example.org/${i}`, title: "Hours", excerpt: "Search evidence" })); },
    async read(urls) { reads.push(urls); if (reads.length === 1) throw new Error("Unavailable"); return urls.map(url => ({ url, excerpt: "Read evidence" })); },
  };
  const result = await researchForCoordinator("Museum hours", provider, undefined, undefined, [{ url: "https://museum.example.org/visit", title: "Museum" }]);
  assert.deepEqual(reads.map(urls => urls.length), [1, 2]);
  assert.equal(result.status, "partial");
});
