import assert from "node:assert/strict";
import dns from "node:dns/promises";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { registerComponentImportStubs } from "./test-support/hook-harness";

registerComponentImportStubs();

const mapUrl = "https://www.google.com/maps/place/Sonoma+Plaza/@38.2933,-122.4580,17z";

for (const version of ["v24.21.0", "v24.22.1-rc.1", "v25.9.0"]) {
  test(`preview refuses ${version} before parsing, map shortcuts, DNS or fetch`, async (t) => {
    const descriptor = Object.getOwnPropertyDescriptor(process, "version")!;
    const lookup = t.mock.method(dns, "lookup", async () => { throw new Error("DNS must not run"); });
    const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("fetch must not run"); });
    syncBuiltinESMExports();
    const { previewExternalLink, LinkPreviewError } = await import("./link-preview");
    try {
      Object.defineProperty(process, "version", { ...descriptor, value: version });
      for (const input of ["not a URL", mapUrl, "https://example.com/venue"]) {
        await assert.rejects(previewExternalLink(input), (error: unknown) => {
          assert.ok(error instanceof LinkPreviewError);
          assert.equal(error.status, 503);
          return true;
        });
      }
      assert.equal(lookup.mock.callCount(), 0);
      assert.equal(fetch.mock.callCount(), 0);
    } finally {
      Object.defineProperty(process, "version", descriptor);
      t.mock.restoreAll();
      syncBuiltinESMExports();
    }
  });
}

test("patched runtime restores map and fetched previews without bypassing redirect destination checks", async (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(process, "version")!;
  const lookup = t.mock.method(dns, "lookup", async () => [{ address: "93.184.216.34", family: 4 }]);
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response("<title>Synthetic museum</title>", { headers: { "content-type": "text/html" } }));
  syncBuiltinESMExports();
  const { previewExternalLink, LinkPreviewError } = await import("./link-preview");
  try {
    Object.defineProperty(process, "version", { ...descriptor, value: "v24.22.1" });
    assert.equal((await previewExternalLink(mapUrl)).title, "Sonoma Plaza");
    assert.equal(lookup.mock.callCount(), 0);
    assert.equal(fetch.mock.callCount(), 0);
    assert.equal((await previewExternalLink("https://example.com/venue")).title, "Synthetic museum");
    assert.equal(lookup.mock.callCount(), 1);
    assert.equal(fetch.mock.callCount(), 1);
    fetch.mock.mockImplementation(async () => new Response(null, { status: 302, headers: { location: "http://localhost/private" } }));
    await assert.rejects(previewExternalLink("https://example.com/redirect"), (error: unknown) => {
      assert.ok(error instanceof LinkPreviewError);
      assert.match(error.message, /private network/);
      return true;
    });
    assert.equal(fetch.mock.callCount(), 2, "the private redirect must never be fetched");
  } finally {
    Object.defineProperty(process, "version", descriptor);
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});
