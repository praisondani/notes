import { NextResponse } from "next/server";
import { isAuthConfigurationReady, sameOriginRequest, setupAccount } from "@/lib/auth";
import { readJsonBody, RequestBodyError } from "@/lib/request-body";

export async function POST(request: Request) {
  if (!isAuthConfigurationReady()) return NextResponse.json({ error: "Authentication is not configured" }, { status: 503 });
  if (!sameOriginRequest(request)) return NextResponse.json({ error: "Request origin is not allowed" }, { status: 403 });
  let parsedBody: unknown;
  try {
    parsedBody = await readJsonBody(request, 8 * 1024);
  } catch (error) {
    const status = error instanceof RequestBodyError ? error.status : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request body" }, { status });
  }
  const body = parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody) ? parsedBody as { username?: unknown; email?: unknown; password?: unknown } : {};
  try {
    const user = await setupAccount({ username: typeof body.username === "string" ? body.username : "", email: typeof body.email === "string" ? body.email : "", password: typeof body.password === "string" ? body.password : "" });
    return NextResponse.json({ ok: true, user });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Account setup failed";
    return NextResponse.json({ error: message }, { status: message === "Auth account already exists" ? 409 : 400 });
  }
}
