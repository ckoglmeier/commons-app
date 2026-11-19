import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { tripCardCoverUrl } from "../lib/trip-card-cover";

test("standalone cover uploads stay outside Trip photos", async () => {
  const workspace = await readFile(new URL("./commons-app.tsx", import.meta.url), "utf8");
  const workspaceUpload = workspace.slice(workspace.indexOf("async function useUploadedCover"), workspace.indexOf("async function saveCover"));
  assert.match(workspaceUpload, /persistCover\(file, null\)/);
  assert.doesNotMatch(workspaceUpload, /persistNewMoment/);
  assert.match(workspace, /Browse Commons covers/);
});

test("event cards request the stored lightweight cover", async () => {
  const [source, helper, route] = await Promise.all([
    readFile(new URL("./trips-index.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/trip-card-cover.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/v1/commons/[slug]/cover-image/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(source, /src=\{tripCardCoverUrl\(trip\.commons\)\}/);
  assert.match(helper, /searchParams\.set\("variant", "card"\)/);
  assert.match(helper, /\?variant=card&v=\$\{encodeURIComponent\(momentId\)\}/);
  assert.doesNotMatch(source, /coverCardImageUrl \?\? trip\.commons\.coverImageUrl/);
  assert.match(route, /createStoredCoverCard/);
  assert.match(route, /storeCommonsPhotoAsset/);
  assert.match(route, /max-age=31536000, immutable/);

  assert.equal(tripCardCoverUrl({ slug: "spring-break", coverImageUrl: "/api/v1/commons/spring-break/cover-image?variant=original&v=one", coverCardImageUrl: null }), "/api/v1/commons/spring-break/cover-image?variant=card&v=one");
  assert.equal(tripCardCoverUrl({ slug: "spring-break", coverImageUrl: "/api/v1/commons/spring-break/moments/1234", coverCardImageUrl: null }), "/api/v1/commons/spring-break/cover-image?variant=card&v=1234");
  assert.equal(tripCardCoverUrl({ slug: "spring-break", coverImageUrl: null, coverCardImageUrl: "/api/v1/commons/spring-break/cover-image?variant=original&v=legacy" }), "/api/v1/commons/spring-break/cover-image?variant=card&v=legacy");
  assert.equal(tripCardCoverUrl({ slug: "spring-break", coverImageUrl: null, coverCardImageUrl: "/api/v1/commons/spring-break/moments/legacy-cover" }), "/api/v1/commons/spring-break/cover-image?variant=card&v=legacy-cover");
  assert.equal(tripCardCoverUrl({ slug: "spring-break", coverImageUrl: "https://images.example/original.jpg", coverCardImageUrl: null }), null);
});

test("photo captions meet AA even over a pure white image", async () => {
  const tokens = await readFile(new URL("../../../packages/ui/src/tokens.css", import.meta.url), "utf8");
  const caption = tokens.match(/--cm-color-photo-caption: rgb\((\d+) (\d+) (\d+) \/ (\d+)%\)/);
  assert.ok(caption, "Caption protection must be an explicit shared color");
  const alpha = Number(caption[4]) / 100;
  const background = caption.slice(1, 4).map(value => Number(value) * alpha + 255 * (1 - alpha));
  const luminance = (color: number[]) => color.map(value => value / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  for (const name of ["paper", "on-ink-secondary"]) {
    const hex = tokens.match(new RegExp(`--cm-color-${name}: (#[a-f0-9]{6})`, "i"))?.[1];
    assert.ok(hex);
    const foreground = hex.slice(1).match(/../g)!.map(value => parseInt(value, 16));
    assert.ok((luminance(foreground) + .05) / (luminance(background) + .05) >= 4.5, `${name} on a bright photo`);
  }
});
