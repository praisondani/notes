import { NextResponse } from "next/server";
import { isAuthenticated, sameOriginRequest } from "@/lib/auth";
import { storeObject } from "@/lib/storage";
import { readRequestBytes, RequestBodyError } from "@/lib/request-body";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_FILE_BYTES + 1024 * 1024;

export async function POST(request: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!sameOriginRequest(request)) return NextResponse.json({ error: "Request origin is not allowed" }, { status: 403 });
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType)) return NextResponse.json({ error: "A multipart file upload is required" }, { status: 400 });

  let formData: FormData;
  try {
    const bytes = await readRequestBytes(request, MAX_REQUEST_BYTES);
    const uploadRequest = new Request(request.url, { method: "POST", headers: { "Content-Type": contentType }, body: bytes });
    formData = await uploadRequest.formData();
  } catch (error) {
    const status = error instanceof RequestBodyError ? error.status : 400;
    return NextResponse.json({ error: status === 413 ? "Files must be 25 MB or smaller" : "The upload form is invalid" }, { status });
  }

  const files = formData.getAll("file");
  const file = files.length === 1 ? files[0] : null;
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Exactly one file is required" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "Files must be 25 MB or smaller" }, { status: 413 });
  }
  const stored = await storeObject(file);
  return NextResponse.json(stored);
}
