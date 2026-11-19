import sharp from "sharp";
import { COVER_CARD_MAX_HEIGHT, COVER_CARD_MAX_WIDTH } from "@/lib/cover-image";

export const COVER_CARD_MAX_BYTES = 250 * 1024;

const attempts = [
  { width: COVER_CARD_MAX_WIDTH, height: COVER_CARD_MAX_HEIGHT, quality: 72 },
  { width: 640, height: 427, quality: 60 },
  { width: 560, height: 373, quality: 48 },
];

export async function createStoredCoverCard(input: ArrayBuffer | Uint8Array) {
  for (const attempt of attempts) {
    const output = await sharp(input)
      .rotate()
      .resize({
        width: attempt.width,
        height: attempt.height,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: attempt.quality, effort: 4 })
      .toBuffer();
    if (output.byteLength <= COVER_CARD_MAX_BYTES) return output;
  }
  throw new Error("Cover card could not be reduced below the storage limit.");
}
