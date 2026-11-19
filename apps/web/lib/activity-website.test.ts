import assert from "node:assert/strict";
import test from "node:test";
import { publicActivityWebsite } from "@commons/contracts";

test("shared venue websites preserve public pages and exclude private URL data before context projection", () => {
  assert.equal(publicActivityWebsite("https://audubon.example.org/visit#hours"), "https://audubon.example.org/visit");
  for (const url of [
    "https://example.org/marker@example.org", "https://example.org/marker%40example.org", "https://example.org/marker%2540example.org",
    "https://example.org/visit?email=marker@example.org", "https://example.org/visit?token=secret",
    "https://example.org/booking/secret", "https://example.org/%62ooking/secret", "https://user:secret@example.org/visit",
    "http://example.org/visit", "https://127.0.0.1/visit", "https://[::ffff:127.0.0.1]/visit", "https://venue.internal/visit", "not a URL",
  ]) assert.equal(publicActivityWebsite(url), null, url);
});
