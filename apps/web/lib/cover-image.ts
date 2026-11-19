export const COVER_CARD_MAX_WIDTH = 720;
export const COVER_CARD_MAX_HEIGHT = 480;
export const COVER_CARD_QUALITY = 0.78;

export function coverCardDimensions(width: number, height: number) {
  const scale = Math.min(1, COVER_CARD_MAX_WIDTH / width, COVER_CARD_MAX_HEIGHT / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function createCoverCardImage(photo: Blob) {
  const bitmap = await createImageBitmap(photo, { imageOrientation: "from-image" });
  try {
    const dimensions = coverCardDimensions(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser could not prepare the cover preview.");
    context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error("This browser could not prepare the cover preview.")),
        "image/webp",
        COVER_CARD_QUALITY,
      );
    });
  } finally {
    bitmap.close();
  }
}

/** Bundled covers are SVG drawings; covers are stored as raster images, so draw the SVG onto a canvas and keep it as a PNG. */
export async function rasterizeCoverDrawing(svg: Blob, width = 1440): Promise<Blob> {
  const url = URL.createObjectURL(svg);
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("That cover couldn’t be loaded. Try another.")); image.src = url; });
    const ratio = image.naturalWidth && image.naturalHeight ? image.naturalHeight / image.naturalWidth : 2 / 3;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = Math.max(1, Math.round(width * ratio));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser could not prepare the cover.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("This browser could not prepare the cover.")), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}
