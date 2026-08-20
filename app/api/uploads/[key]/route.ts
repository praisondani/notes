import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { readLocalObject } from "@/lib/storage";

export const runtime = "nodejs";

function contentType(key: string): string {
  const extension = key.split(".").pop()?.toLowerCase();
  const types: Record<string, string> = {
    avif: "image/avif",
    gif: "image/gif",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    m4a: "audio/mp4",
    mp3: "audio/mpeg",
    pdf: "application/pdf",
    png: "image/png",
    svg: "image/svg+xml",
    txt: "text/plain; charset=utf-8",
    webp: "image/webp",
  };
  return types[extension ?? ""] ?? "application/octet-stream";
}

export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const { key } = await params;
    const buffer = await readLocalObject(decodeURIComponent(key));
    return new NextResponse(new Uint8Array(buffer) as unknown as BodyInit, { headers: { "Content-Type": contentType(key), "Cache-Control": "public, max-age=31536000, immutable" } });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
