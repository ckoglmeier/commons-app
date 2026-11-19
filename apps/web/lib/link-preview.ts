import "server-only";

import { lookup } from "node:dns/promises";
import {
  extractLinkPreview,
  fallbackLinkPreview,
  isPrivateNetworkAddress,
  LinkPreviewError,
  mapLinkPreview,
  normalizeExternalUrl,
} from "./link-preview-core";
import { hasOctober2026NodeSecurityPatches } from "./link-preview-runtime";

export { LinkPreviewError } from "./link-preview-core";

const maxHtmlBytes = 1_000_000;
const maxRedirects = 3;
const requestTimeoutMs = 7_000;

async function assertPublicDestination(url: URL) {
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new LinkPreviewError("That link points to a private network address.");
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateNetworkAddress(address))) {
    throw new LinkPreviewError("That link points to a private network address.");
  }
}

async function readBoundedHtml(response: Response) {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > maxHtmlBytes) throw new LinkPreviewError("That page is too large to preview.", 413);
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxHtmlBytes) {
      await reader.cancel();
      throw new LinkPreviewError("That page is too large to preview.", 413);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

export async function previewExternalLink(input: string) {
  if (!hasOctober2026NodeSecurityPatches(process.version)) {
    throw new LinkPreviewError(
      "Link previews are temporarily unavailable while a security update is applied.",
      503,
    );
  }
  const original = normalizeExternalUrl(input);
  let url = original;
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    // Shortened maps links resolve through these same checked redirects.
    const mapPlace = mapLinkPreview(url, original);
    if (mapPlace) return mapPlace;
    await assertPublicDestination(url);
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { "user-agent": "Commons Link Preview/1.0", accept: "text/html,application/xhtml+xml" },
        redirect: "manual",
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch {
      return fallbackLinkPreview(url);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirect === maxRedirects) throw new LinkPreviewError("That link redirects too many times.");
      url = normalizeExternalUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) return fallbackLinkPreview(url);
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      return fallbackLinkPreview(url);
    }
    return extractLinkPreview(url, await readBoundedHtml(response));
  }
  throw new LinkPreviewError("That link could not be previewed.");
}
