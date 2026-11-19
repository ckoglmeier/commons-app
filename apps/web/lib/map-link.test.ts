import assert from "node:assert/strict";
import test from "node:test";
import { extractLinkPreview, mapLinkPreview } from "./link-preview-core";
import { mapLinkPlace } from "./map-link";

test("reads the place marker from a Google Maps place link before its viewport", () => {
  const place = mapLinkPlace(new URL("https://www.google.com/maps/place/The+Lodge+at+Sonoma/@38.28,-122.46,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x1!8m2!3d38.2797!4d-122.4585!16s%2Fg%2F1"));
  assert.deepEqual(place, { title: "The Lodge at Sonoma", siteName: "Google Maps", pin: { latitude: 38.2797, longitude: -122.4585, source: "map_link" } });
  assert.deepEqual(mapLinkPlace(new URL("https://www.google.com/maps/place/Sonoma+Plaza/@38.2933,-122.4580,17z"))?.pin,
    { latitude: 38.2933, longitude: -122.458, source: "map_link" });
});

test("reads coordinate queries from Google and Apple Maps links", () => {
  assert.deepEqual(mapLinkPlace(new URL("https://maps.google.com/?q=38.2933,-122.4258"))?.pin, { latitude: 38.2933, longitude: -122.4258, source: "map_link" });
  assert.deepEqual(mapLinkPlace(new URL("https://www.google.com/maps/search/?api=1&query=38.29,-122.42"))?.pin, { latitude: 38.29, longitude: -122.42, source: "map_link" });
  const apple = mapLinkPlace(new URL("https://maps.apple.com/place?coordinate=35.6870,-105.9378&name=Santa%20Fe%20Plaza"));
  assert.equal(apple?.title, "Santa Fe Plaza");
  assert.deepEqual(apple?.pin, { latitude: 35.687, longitude: -105.9378, source: "map_link" });
  assert.deepEqual(mapLinkPlace(new URL("https://maps.apple.com/?ll=35.68,-105.93&q=Canyon%20Road"))?.title, "Canyon Road");
});

test("does not treat a map view, search words or impossible numbers as a place", () => {
  assert.equal(mapLinkPlace(new URL("https://www.google.com/maps/@38.29,-122.45,14z")), null);
  assert.equal(mapLinkPlace(new URL("https://www.google.com/maps/search/wineries+near+sonoma")), null);
  assert.equal(mapLinkPlace(new URL("https://maps.google.com/?q=95.1,-122.4")), null);
  assert.equal(mapLinkPlace(new URL("https://maps.apple.com/?address=1325%20Broadway,%20Sonoma")), null);
  assert.equal(mapLinkPlace(new URL("https://example.com/maps/place/x/@38.2,-122.4")), null);
});

test("a maps link becomes a named place preview without loading the page", () => {
  const original = new URL("https://maps.app.goo.gl/abc123");
  const preview = mapLinkPreview(new URL("https://www.google.com/maps/place/Gundlach+Bundschu+Winery/data=!3d38.2932!4d-122.4269"), original);
  assert.equal(preview?.title, "Gundlach Bundschu Winery");
  assert.equal(preview?.kind, "place");
  assert.deepEqual(preview?.pin, { latitude: 38.2932, longitude: -122.4269, source: "map_link" });
  assert.equal(mapLinkPreview(original, original), undefined);
});

test("uses the selected venue's published coordinates, not its publisher's", () => {
  const preview = extractLinkPreview(new URL("https://www.example-hotel.com/sonoma"), `<html><head><title>The Lodge at Sonoma | Luxury Sonoma Resort &amp; Spa</title>
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Hotel","name":"The Lodge at Sonoma",
      "address":{"@type":"PostalAddress","streetAddress":"1325 Broadway","addressLocality":"Sonoma","addressRegion":"CA"},
      "geo":{"@type":"GeoCoordinates","latitude":"38.2797","longitude":"-122.4585"},
      "brand":{"@type":"Organization","name":"Brand","geo":{"latitude":40.7,"longitude":-74}}}</script></head></html>`);
  assert.equal(preview.title, "The Lodge at Sonoma");
  const branded = extractLinkPreview(new URL("https://www.example-hotel.com/"), `<html><head><meta property="og:title" content="The Lodge at Sonoma | Luxury Resort">
    <script type="application/ld+json">{"@type":"Hotel","name":"The Lodge at Sonoma Resort, Autograph Collection"}</script></head></html>`);
  assert.equal(branded.title, "The Lodge at Sonoma");
  const plain = extractLinkPreview(new URL("https://www.example.com/a"), `<html><head><title>Ten Sonoma wineries | Travel Guide</title></head></html>`);
  assert.equal(plain.title, "Ten Sonoma wineries | Travel Guide");
  assert.equal(preview.location, "1325 Broadway, Sonoma, CA");
  assert.deepEqual(preview.pin, { latitude: 38.2797, longitude: -122.4585, source: "page" });

  const ambiguous = extractLinkPreview(new URL("https://www.example.com/two"), `<html><head><title>Two places</title>
    <script type="application/ld+json">[{"@type":"Winery","name":"A","geo":{"latitude":38.1,"longitude":-122.1}},
      {"@type":"Winery","name":"B","geo":{"latitude":38.2,"longitude":-122.2}}]</script></head></html>`);
  assert.equal(ambiguous.pin, undefined);

  const article = extractLinkPreview(new URL("https://www.example.com/article"), `<html><head><title>Ten wineries</title>
    <script type="application/ld+json">{"@type":"Article","publisher":{"@type":"Organization","geo":{"latitude":38.1,"longitude":-122.1}}}</script></head></html>`);
  assert.equal(article.pin, undefined);
});
