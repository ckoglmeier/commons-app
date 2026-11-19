import assert from "node:assert/strict";
import test from "node:test";
import {
  extractLinkPreview,
  fallbackLinkPreview,
  isPrivateNetworkAddress,
  LinkPreviewError,
  normalizeExternalUrl,
} from "./link-preview-core";
import { hasOctober2026NodeSecurityPatches } from "./link-preview-runtime";

test("enables link previews only on Node releases patched for the October 2026 advisory", () => {
  for (const version of ["v22.23.4", "24.22.1", "v24.23.0", "26.12.1"]) {
    assert.equal(hasOctober2026NodeSecurityPatches(version), true, version);
  }
  for (const version of ["v22.23.3", "24.21.0", "v24.22.1-rc.1", "v26.12.0", "25.9.0", "unknown"]) {
    assert.equal(hasOctober2026NodeSecurityPatches(version), false, version);
  }
});

test("extracts an AllTrails hike into an activity preview", () => {
  const preview = extractLinkPreview(
    new URL("https://www.alltrails.com/trail/us/colorado/royal-arch-trail"),
    `<!doctype html><html><head>
      <meta property="og:site_name" content="AllTrails">
      <meta content="Royal Arch Trail | AllTrails" property="og:title">
      <meta name="description" content="A 3.4-mile hard hike near Boulder, Colorado.">
    </head></html>`,
  );
  assert.equal(preview.kind, "activity");
  assert.equal(preview.title, "Royal Arch Trail");
  assert.equal(preview.siteName, "AllTrails");
  assert.equal(preview.detailStatus, "extracted");
  assert.match(preview.description ?? "", /3.4-mile/);
});

test("creates an editable link-only draft when a publisher blocks extraction", () => {
  const preview = fallbackLinkPreview(new URL("https://www.alltrails.com/trail/us/colorado/royal-arch-trail"));
  assert.equal(preview.title, "Royal Arch Trail");
  assert.equal(preview.siteName, "AllTrails");
  assert.equal(preview.kind, "activity");
  assert.equal(preview.detailStatus, "link_only");
});

test("uses structured restaurant address when a publisher provides it", () => {
  const preview = extractLinkPreview(
    new URL("https://example.com/restaurants/the-shed"),
    `<html><head><title>The Shed</title><script type="application/ld+json">{
      "@type":"Restaurant",
      "name":"The Shed",
      "description":"New Mexican cooking near the plaza.",
      "address":{"streetAddress":"113 1/2 E Palace Ave","addressLocality":"Santa Fe","addressRegion":"NM"}
    }</script></head></html>`,
  );
  assert.equal(preview.kind, "restaurant");
  assert.equal(preview.location, "113 1/2 E Palace Ave, Santa Fe, NM");
});

test("normalizes share links without fragments and rejects embedded credentials", () => {
  assert.equal(normalizeExternalUrl("https://example.com/hike#reviews").toString(), "https://example.com/hike");
  assert.throws(() => normalizeExternalUrl("https://person:secret@example.com/hike"), LinkPreviewError);
});

test("recognizes private IPv4, mapped IPv4, and local IPv6 ranges", () => {
  assert.equal(isPrivateNetworkAddress("127.0.0.1"), true);
  assert.equal(isPrivateNetworkAddress("192.168.1.8"), true);
  assert.equal(isPrivateNetworkAddress("::1"), true);
  assert.equal(isPrivateNetworkAddress("::ffff:10.0.0.2"), true);
  assert.equal(isPrivateNetworkAddress("93.184.216.34"), false);
  assert.equal(isPrivateNetworkAddress("2606:2800:220:1:248:1893:25c8:1946"), false);
});

function structuredPreview(value: unknown, title = "Museum visit") {
  return extractLinkPreview(new URL("https://example.com/visit"), `<title>${title}</title><script type="application/ld+json">${JSON.stringify(value)}</script>`);
}
const venueAddress = { streetAddress: "12 Museum Road", addressLocality: "Bath", addressRegion: "Somerset", postalCode: "BA1 1AA", addressCountry: { "@type": "Country", name: "United Kingdom" } };
const expectedAddress = "12 Museum Road, Bath, Somerset, BA1 1AA, United Kingdom";

test("extracts an event's nested venue with postal code and country", () => {
  assert.equal(structuredPreview({ "@type": "Event", name: "Museum visit", location: { "@type": "Place", address: venueAddress } }).location, expectedAddress);
});

test("resolves page mainEntity, venue and address references across graph nodes", () => {
  const preview = structuredPreview({ "@graph": [
    { "@type": "Organization", name: "Publisher", address: "Wrong corporate address" },
    { "@type": "WebPage", "@id": "https://example.com/visit#page", mainEntity: { "@id": "#event" } },
    { "@type": "Event", "@id": "#event", name: "Museum visit", location: { "@id": "#venue" } },
    { "@type": "Place", "@id": "#venue", address: { "@id": "#address" } },
    { "@type": "PostalAddress", "@id": "#address", ...venueAddress },
  ] });
  assert.equal(preview.location, expectedAddress);
});

test("prefers the page-matched venue over other businesses", () => {
  assert.equal(structuredPreview([
    { "@type": "Restaurant", name: "Other", url: "https://example.com/other", address: "Wrong address" },
    { "@type": "Museum", name: "Museum visit", url: "https://example.com/visit", address: venueAddress },
  ]).location, expectedAddress);
});

test("does not choose among multiple venues or use publisher/organizer addresses", () => {
  for (const value of [
    [{ "@type": "Restaurant", address: "One" }, { "@type": "Restaurant", address: "Two" }],
    { "@type": "Event", location: [{ "@type": "Place", address: "One" }, { "@type": "Place", address: "Two" }] },
    { "@type": "Event", location: [{ "@type": "Place", address: "One" }, { "@type": "Place" }] },
    { "@type": "Organization", name: "Publisher", address: "Head office" },
    { "@type": "Event", publisher: { "@type": "Organization", address: "Head office" }, organizer: { address: "Office" } },
  ]) assert.equal(structuredPreview(value).location, undefined);
});

test("does not fall back to another venue when the explicit subject lacks an address", () => {
  assert.equal(structuredPreview([
    { "@type": "WebPage", url: "https://example.com/visit", mainEntity: { "@id": "#event" } },
    { "@type": "Event", "@id": "#event", name: "Museum visit" },
    { "@type": "Restaurant", address: "Unrelated restaurant" },
  ]).location, undefined);
});

test("handles cycles and unresolved references without guessing or fetching", () => {
  for (const location of [{ "@id": "#event" }, { "@id": "https://elsewhere.example/venue" }]) {
    assert.equal(structuredPreview({ "@type": "Event", "@id": "#event", location }).location, undefined);
  }
});

test("supports nested mainEntity and schema URL types", () => {
  assert.equal(structuredPreview({ "@type": "WebPage", url: "https://example.com/visit", mainEntity: { "@type": "https://schema.org/Event", location: { address: venueAddress } } }).location, expectedAddress);
});

test("valid JSON containing HTML entities keeps its quoted address", () => {
  assert.equal(structuredPreview({ "@type": "Museum", address: "12 &quot;Old&quot; Road &amp; Lane" }).location, '12 "Old" Road & Lane');
});

test("malformed JSON and invalid numeric entities preserve a usable preview", () => {
  const preview = extractLinkPreview(new URL("https://example.com/visit"), '<title>Museum &#999999999;</title><script type="application/ld+json">{broken</script>');
  assert.equal(preview.title, "Museum");
  assert.equal(preview.location, undefined);
});

test("accepts unquoted JSON-LD script type and string country", () => {
  const preview = extractLinkPreview(new URL("https://example.com/visit"), '<title>Museum</title><script type=application/ld+json>{"@type":"Museum","address":{"streetAddress":"1 Main St","postalCode":"87501","addressCountry":"US"}}</script>');
  assert.equal(preview.location, "1 Main St, 87501, US");
});

test("repeated identical locations are not treated as competing venues", () => {
  assert.equal(structuredPreview({ "@type": "Event", location: [{ address: venueAddress }, { address: venueAddress }] }).location, expectedAddress);
});


test("a sole event owns its nested venue even with a decorated page title", () => {
  assert.equal(structuredPreview({ "@type": "Event", name: "Museum", location: { "@type": "Place", name: "Venue", address: venueAddress } }, "Buy tickets | Museum").location, expectedAddress);
});

test("conflicting graph IDs and excessive metadata fail closed", () => {
  assert.equal(structuredPreview([
    { "@type": "WebPage", url: "https://example.com/visit", mainEntity: { "@id": "#venue" } },
    { "@type": "Place", "@id": "#venue", address: "One" },
    { "@type": "Place", "@id": "#venue", address: "Two" },
  ]).location, undefined);
  assert.equal(structuredPreview(Array.from({ length: 520 }, (_, index) => ({ "@type": "Place", address: `Place ${index}` }))).location, undefined);
});


test("an unresolved explicit subject cannot select a different restaurant", () => {
  assert.equal(structuredPreview([
    { "@type": "WebPage", url: "https://example.com/visit", mainEntity: { "@id": "#missing" } },
    { "@type": "Restaurant", address: "Unrelated venue" },
  ]).location, undefined);
});

test("over-limit addresses remain within the existing preview/save contract", () => {
  assert.equal(structuredPreview({ "@type": "Place", address: "A".repeat(200) }).location?.length, 160);
});

test("adds published days/hours and public venue phone to the existing description", () => {
  const preview = structuredPreview({ "@type": "Museum", description: "Hands-on exhibits.", openingHours: "Mo-Fr 09:00-17:00", telephone: "+44 1225 123456" });
  assert.equal(preview.description, "Hands-on exhibits.\n\nPublished hours (local): Mon-Fri: 9:00 AM–5:00 PM\nVenue phone: +44 1225 123456");
});

test("nested venue hours preserve overnight and dated special restrictions", () => {
  const preview = structuredPreview({ "@type": "Event", location: { "@type": "Place",
    openingHoursSpecification: { dayOfWeek: ["https://schema.org/Friday", "Saturday"], opens: "19:00:00", closes: "01:00:00" },
    specialOpeningHoursSpecification: { validFrom: "2027-12-24", validThrough: "2027-12-25", opens: "09:00", closes: "12:00" },
  } });
  assert.equal(preview.description, "Published hours (local): Fri, Sat: 7:00 PM–1:00 AM (next day)\nSpecial hours: from 2027-12-24 through 2027-12-25: 9:00 AM–12:00 PM");
});

test("resolves graph-linked venue hours but never publisher hours", () => {
  const preview = structuredPreview({ "@graph": [
    { "@type": "WebPage", url: "https://example.com/visit", mainEntity: { "@id": "#venue" }, publisher: { "@id": "#publisher" } },
    { "@id": "#publisher", "@type": "Organization", openingHours: "Every day forever", telephone: "Wrong phone" },
    { "@id": "#venue", "@type": "Museum", openingHoursSpecification: { "@id": "#hours" } },
    { "@id": "#hours", dayOfWeek: { "@id": "https://schema.org/Tuesday" }, opens: "10:00", closes: "16:30", validFrom: "2027-05-01" },
  ] });
  assert.equal(preview.description, "Published hours (local): Tue from 2027-05-01: 10:00 AM–4:30 PM");
});

test("ambiguous venues do not contribute hours or phone", () => {
  const preview = structuredPreview([{ "@type": "Museum", openingHours: "Mo-Fr 09:00-17:00", telephone: "111" }, { "@type": "Museum", openingHours: "Sa 09:00-12:00", telephone: "222" }]);
  assert.equal(preview.description, undefined);
});

test("incomplete or invalid hours never turn a partial weekly schedule into full coverage", () => {
  for (const invalid of [
    { dayOfWeek: "Monday", opens: "09:00" },
    { dayOfWeek: "Monday", opens: "00:00", closes: "00:00" },
    { dayOfWeek: "Noday", opens: "09:00", closes: "17:00" },
    { dayOfWeek: "Monday", opens: "09:00", closes: "17:00", validThrough: "not a date" },
    { dayOfWeek: "Monday", opens: "09:00", closes: "17:00", validThrough: "2027-02-31" },
    { dayOfWeek: "Monday", opens: "09:00", closes: "17:00", validFrom: "2027-08-31", validThrough: "2027-05-01" },
  ]) {
    const preview = structuredPreview({ "@type": "Museum", openingHours: "Mo-Fr 09:00-17:00", specialOpeningHoursSpecification: invalid });
    assert.equal(preview.description, "Published hours: See website for the full schedule and exceptions.");
  }
});

test("long descriptions reserve space for complete hours and their seasonal limits", () => {
  const preview = structuredPreview({ "@type": "Museum", description: "Exhibits ".repeat(100), openingHoursSpecification: { dayOfWeek: "Monday", opens: "09:00", closes: "17:00", validThrough: "2027-08-31" } });
  assert.ok(preview.description!.length <= 500);
  assert.match(preview.description!, /…\n\nPublished hours \(local\): Mon through 2027-08-31: 9:00 AM–5:00 PM$/);
});

test("long schedules link back to the source rather than cutting off exceptions", () => {
  const preview = structuredPreview({ "@type": "Museum", openingHoursSpecification: Array.from({ length: 20 }, (_, index) => ({ dayOfWeek: "Monday", opens: "09:00", closes: "17:00", validFrom: `2027-01-${String(index + 1).padStart(2, "0")}` })) });
  assert.equal(preview.description, "Published hours: See website for the full schedule and exceptions.");
});

test("missing hours leave the description unchanged and do not infer closed days", () => {
  assert.equal(structuredPreview({ "@type": "Museum", description: "Exhibits." }).description, "Exhibits.");
});

test("restaurant preview keeps published reservations, phone and complete policy with source", () => {
  const preview = extractLinkPreview(new URL("https://example.com/restaurant"), `<title>Example dining</title><script type="application/ld+json">${JSON.stringify({ "@type": "Restaurant", name: "Example dining", address: "10 Main Street", telephone: "+1 555 0100", openingHours: "Mo-Fr 17:00-22:00", acceptsReservations: true })}</script><h2>Reservation policy</h2><p>Cancel at least 24 hours before arrival. Late cancellation costs $25 per guest.</p>`);
  assert.match(preview.description!, /Reservations: Accepted, as published/);
  assert.match(preview.description!, /24 hours.*\$25 per guest/);
  assert.match(preview.description!, /Venue phone: \+1 555 0100/);
  assert.equal(preview.location, "10 Main Street");
  assert.ok(preview.description!.length <= 500);
});

test("restaurant policies omit unrelated hidden content and never truncate a long restriction", () => {
  const markup = `<title>Dining</title><script type="application/ld+json">{"@type":"Restaurant","name":"Dining","acceptsReservations":false}</script>`;
  const hidden = extractLinkPreview(new URL("https://example.com"), markup + `<script><h2>Reservation policy</h2><p>False policy.</p></script><footer><h2>Reservations</h2><p>Publisher policy.</p></footer>`);
  assert.match(hidden.description!, /Reservations: Not accepted/);
  assert.doesNotMatch(hidden.description!, /False policy|Publisher policy/);
  const long = extractLinkPreview(new URL("https://example.com"), markup + `<h2>Cancellation policy</h2><p>${"Restriction ".repeat(30)}A fee applies.</p>`);
  assert.match(long.description!, /See website for the full policy/);
  assert.doesNotMatch(long.description!, /Restriction/);
});

test("reservation policy includes fees in lists, containers and subheadings", () => {
  for (const restriction of ['<ul><li>Late cancellations incur $50 per guest.</li></ul>', '<div>Late cancellations incur $50 per guest.</div>', '<h3>Exceptions</h3><p>Late cancellations incur $50 per guest.</p>']) {
    const preview = extractLinkPreview(new URL('https://example.com'), `<title>Dining</title><script type="application/ld+json">{"@type":"Restaurant","name":"Dining"}</script><h2>Cancellation policy</h2><p>Cancel up to 24 hours before.</p>${restriction}<h2>Menu</h2><p>Unrelated menu.</p>`);
    assert.match(preview.description!, /\$50 per guest/);
    assert.doesNotMatch(preview.description!, /Unrelated menu/);
  }
});
