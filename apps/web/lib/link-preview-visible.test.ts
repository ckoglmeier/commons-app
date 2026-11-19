import assert from "node:assert/strict";
import test from "node:test";
import { extractLinkPreview } from "./link-preview-core";
const url = new URL("https://museum.example/");
const header = '<title>About Example Art Museum</title><meta property="og:site_name" content="Example Art Museum"><meta name="description" content="Art and gardens.">';
const block = (street = "227 Museum Road", phone = "(575) 758-2690") => `<div><span>Example Art Museum</span><br><span>&nbsp;${street}</span><br><span>Taos, New Mexico 87571</span><br><span>${phone}<br>Contact us</span></div>`;

test("plain HTML venue block imports address and phone without inventing homepage hours", () => {
  const preview = extractLinkPreview(url, header + block());
  assert.equal(preview.location, "227 Museum Road, Taos, New Mexico 87571");
  assert.equal(preview.description, "Art and gardens.\n\nVenue phone: (575) 758-2690");
});
test("repeated identical contact blocks deduplicate, conflicting locations or phones fail closed", () => {
  assert.ok(extractLinkPreview(url, header + block() + block()).location);
  for (const other of [block("9 Other Road"), block("227 Museum Road", "(575) 758-1111")]) {
    const preview = extractLinkPreview(url, header + block() + other);
    assert.equal(preview.location, undefined);
    assert.equal(preview.description, "Art and gardens.");
  }
});
test("publisher footer, script, navigation and partial postal blocks do not become venue facts", () => {
  for (const html of [header.replace("About Example Art Museum", "Ten places to visit") + block(), header + `<script>${block()}</script>`, header + `<nav>${block()}</nav>`, header + block().replace("Taos, New Mexico 87571", "Taos")]) {
    assert.equal(extractLinkPreview(url, html).location, undefined);
  }
});
test("structured ambiguous venues are not overridden by visible footer", () => {
  const json = JSON.stringify([{ "@type": "Museum", name: "One" }, { "@type": "Museum", name: "Two" }]);
  assert.equal(extractLinkPreview(url, header + `<script type="application/ld+json">${json}</script>` + block()).location, undefined);
});
test("Taos Art Museum homepage contact markup regression", () => {
  // Minimal public contact markup from https://www.taosartmuseum.org/, October 11, 2026.
  const html = '<title>About Taos Art Museum at Fechin House</title><meta property="og:site_name" content="TAOS ART MUSEUM at FECHIN HOUSE">' +
    '<div class="paragraph">&#8203;<span>Taos Art Museum at Fechin House</span><br /><span>&nbsp; 227 Paseo del Pueblo Norte</span><br /><span>Taos, New Mexico 87571</span><br /><span>(575) 758-2690<br />&#8203;<a>Contact</a></span></div>';
  const preview = extractLinkPreview(new URL("https://www.taosartmuseum.org/"), html);
  assert.equal(preview.location, "227 Paseo del Pueblo Norte, Taos, New Mexico 87571");
  assert.equal(preview.description, "Venue phone: (575) 758-2690");
});
