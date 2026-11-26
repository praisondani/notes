import { NextResponse } from "next/server";
import { authenticatedUser, sameOriginRequest } from "@/lib/auth";
import { listOAuthClients, revokeOAuthClient } from "@/lib/mcp-oauth";
import { readJsonBody, RequestBodyError } from "@/lib/request-body";

export async function GET(): Promise<Response> {
  if (!(await authenticatedUser())) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const response = NextResponse.json({ clients: await listOAuthClients() });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function DELETE(request: Request): Promise<Response> {
  if (!sameOriginRequest(request)) return NextResponse.json({ error: "Request origin is not allowed" }, { status: 403 });
  if (!(await authenticatedUser())) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  let parsedBody: unknown;
  try {
    parsedBody = await readJsonBody(request, 8 * 1024);
  } catch (error) {
    const status = error instanceof RequestBodyError ? error.status : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request body" }, { status });
  }
  const body = parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody) ? parsedBody as { clientId?: unknown } : {};
  const clientId = typeof body.clientId === "string" ? body.clientId.trim() : "";
  if (!clientId || clientId.length > 512) return NextResponse.json({ error: "A valid clientId is required" }, { status: 400 });
  await revokeOAuthClient(clientId);
  return NextResponse.json({ ok: true });
}
