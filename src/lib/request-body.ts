export class RequestBodyError extends Error {
  constructor(public readonly status: 400 | 413, message: string) {
    super(message);
    this.name = "RequestBodyError";
  }
}

export async function readRequestBytes(request: Request, maxBytes: number): Promise<ArrayBuffer> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) {
    await request.body?.cancel().catch(() => undefined);
    throw new RequestBodyError(413, "Request body is too large.");
  }

  if (!request.body) return new ArrayBuffer(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new RequestBodyError(413, "Request body is too large.");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof RequestBodyError) throw error;
    throw new RequestBodyError(400, "Request body could not be read.");
  } finally {
    reader.releaseLock();
  }

  const body = new ArrayBuffer(totalBytes);
  const target = new Uint8Array(body);
  let offset = 0;
  for (const chunk of chunks) {
    target.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const bytes = await readRequestBytes(request, maxBytes);
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch {
    throw new RequestBodyError(400, "Request body must contain valid JSON.");
  }
}
