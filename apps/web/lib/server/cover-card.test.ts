import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { COVER_CARD_MAX_HEIGHT, COVER_CARD_MAX_WIDTH } from "../cover-image";
import { COVER_CARD_MAX_BYTES, createStoredCoverCard } from "./cover-card";

test("legacy cover cards are bounded WebP assets", async () => {
  const width = 2400;
  const height = 1600;
  const pixels = Buffer.alloc(width * height * 3);
  for (let index = 0; index < pixels.length; index += 1) pixels[index] = (index * 31 + (index >> 3)) % 256;
  const original = await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
  const card = await createStoredCoverCard(original);
  const metadata = await sharp(card).metadata();

  assert.equal(metadata.format, "webp");
  assert.ok((metadata.width ?? Infinity) <= COVER_CARD_MAX_WIDTH);
  assert.ok((metadata.height ?? Infinity) <= COVER_CARD_MAX_HEIGHT);
  assert.ok(card.byteLength <= COVER_CARD_MAX_BYTES);
  assert.ok(card.byteLength < original.byteLength);
});
