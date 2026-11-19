import { ConfirmationMimeTypeSchema } from "@commons/contracts";
import sharp from "sharp";

export async function identifyConfirmationFile(file: File) {
  if (!file.size || file.size > 10 * 1024 * 1024) throw new Error("Choose a confirmation smaller than 10 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const prefix = new TextDecoder("latin1").decode(bytes.subarray(0, 16));
  let mimeType: ReturnType<typeof ConfirmationMimeTypeSchema.parse>;
  let extension: string;
  if (prefix.startsWith("%PDF-")) { mimeType = "application/pdf"; extension = "pdf"; }
  else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) { mimeType = "image/jpeg"; extension = "jpg"; }
  else if (bytes[0] === 0x89 && prefix.slice(1, 4) === "PNG") { mimeType = "image/png"; extension = "png"; }
  else if (prefix.startsWith("RIFF") && prefix.slice(8, 12) === "WEBP") { mimeType = "image/webp"; extension = "webp"; }
  else if (/\.(txt|eml)$/i.test(file.name) && !bytes.includes(0)) {
    mimeType = /\.eml$/i.test(file.name) ? "message/rfc822" : "text/plain";
    extension = mimeType === "message/rfc822" ? "eml" : "txt";
  } else throw new Error("Choose a PDF, PNG, JPEG, WebP, text file, or email export (.eml).");
  if (mimeType.startsWith("image/")) {
    try {
      const metadata = await sharp(bytes, { limitInputPixels: 25_000_000 }).metadata();
      if (!metadata.width || !metadata.height || (metadata.pages ?? 1) > 1) throw new Error("Unsupported image");
    } catch {
      throw new Error("Choose a readable, still image under 25 megapixels.");
    }
  }
  return { bytes, mimeType, extension };
}

export function readEmailText(raw: string): string {
  // Decode bounded MIME text parts only. Never load attachments or resources.
  const chunks = raw.split(/^--[^\r\n]+\r?$/m).slice(0, 100);
  const parts = chunks.flatMap(part => {
    const split = part.search(/\r?\n\r?\n/);
    if (split < 0) return [];
    const headers = part.slice(0, split);
    if (/content-disposition:\s*attachment/i.test(headers) || /content-type:\s*(?!text\/plain|text\/html)[\w-]+\//i.test(headers)) return [];
    let body = part.slice(split).trim();
    if (/content-transfer-encoding:\s*base64/i.test(headers)) body = Buffer.from(body.replace(/\s/g, ""), "base64").toString("utf8");
    else if (/content-transfer-encoding:\s*quoted-printable/i.test(headers)) body = Buffer.from(body.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))), "binary").toString("utf8");
    const html = /content-type:\s*text\/html/i.test(headers);
    if (html) body = body.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "").replace(/<\/?(?:p|div|tr|br|li)\b[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&gt;/g, ">").replace(/&lt;/g, "<");
    return [{ body, html }];
  });
  const plain = parts.filter(part => !part.html);
  return (plain.length ? plain : parts).map(part => part.body).join("\n").slice(0, 100_000);
}
