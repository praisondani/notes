import { describe, expect, it } from "vitest";
import { readJsonBody, readRequestBytes, RequestBodyError } from "@/lib/request-body";

function streamedRequest(chunks: string[], headers?: HeadersInit): Request {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });
  return new Request("http://localhost/test", {
    method: "POST",
    headers,
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

describe("bounded request body parsing", () => {
  it("rejects oversized streamed bodies even when Content-Length is absent", async () => {
    const request = streamedRequest(["1234", "5678"]);
    await expect(readRequestBytes(request, 7)).rejects.toMatchObject({ status: 413 });
  });

  it("rejects an oversized declared length before reading the body", async () => {
    const request = new Request("http://localhost/test", { method: "POST", headers: { "Content-Length": "9" }, body: "x" });
    await expect(readRequestBytes(request, 8)).rejects.toBeInstanceOf(RequestBodyError);
  });

  it("parses valid bounded JSON and rejects malformed JSON", async () => {
    expect(await readJsonBody(new Request("http://localhost/test", { method: "POST", body: JSON.stringify({ ok: true }) }), 64)).toEqual({ ok: true });
    await expect(readJsonBody(new Request("http://localhost/test", { method: "POST", body: "{" }), 64)).rejects.toMatchObject({ status: 400 });
  });
});
