export const maxImportRequestBytes = 11 * 1_024 * 1_024;

export class UploadTooLargeError extends Error {
  constructor() {
    super("Choose a file smaller than 10 MB.");
    this.name = "UploadTooLargeError";
  }
}

export async function readBoundedFormData(
  request: Request,
  maxBytes = maxImportRequestBytes,
) {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new UploadTooLargeError();
  }
  if (!request.body) return request.formData();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedBytes += value.byteLength;
    if (receivedBytes > maxBytes) {
      await reader.cancel();
      throw new UploadTooLargeError();
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const boundedRequest = new Request(request.url, {
    method: request.method,
    headers: { "content-type": request.headers.get("content-type") ?? "" },
    body: new Blob([bytes]),
  });
  return boundedRequest.formData();
}
