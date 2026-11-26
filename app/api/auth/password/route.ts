import { NextResponse } from "next/server";
import { changeAccountPassword, sameOriginRequest } from "@/lib/auth";
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
  const body = parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody) ? parsedBody as { currentPassword?: unknown; newPassword?: unknown } : {};
  try {
    await changeAccountPassword(typeof body.currentPassword === "string" ? body.currentPassword : "", typeof body.newPassword === "string" ? body.newPassword : "");
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Password update failed";
    return NextResponse.json({ error: message }, { status: message === "Authentication required" || message === "Current password is incorrect." ? 401 : 400 });
  }
}
