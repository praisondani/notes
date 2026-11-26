import { NextResponse } from "next/server";
import { sameOriginRequest, updateAccountProfile } from "@/lib/auth";
import { readJsonBody, RequestBodyError } from "@/lib/request-body";

export async function POST(request: Request) {
  if (!sameOriginRequest(request)) return NextResponse.json({ error: "Request origin is not allowed" }, { status: 403 });
  let parsedBody: unknown;
  try {
    parsedBody = await readJsonBody(request, 8 * 1024);
  } catch (error) {
    const status = error instanceof RequestBodyError ? error.status : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request body" }, { status });
  }
  const body = parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody) ? parsedBody as { username?: unknown; email?: unknown } : {};
  try {
    const user = await updateAccountProfile({ username: typeof body.username === "string" ? body.username : "", email: typeof body.email === "string" ? body.email : "" });
    return NextResponse.json({ ok: true, user });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Profile update failed";
    return NextResponse.json({ error: message }, { status: message === "Authentication required" ? 401 : 400 });
  }
}
