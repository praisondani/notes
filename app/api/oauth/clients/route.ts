import { NextResponse } from "next/server";
import { authenticatedUser, sameOriginRequest } from "@/lib/auth";
import { listOAuthClients, revokeOAuthClient } from "@/lib/mcp-oauth";

export async function GET(): Promise<Response> {
  if (!(await authenticatedUser())) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const response = NextResponse.json({ clients: await listOAuthClients() });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function DELETE(request: Request): Promise<Response> {
  if (!sameOriginRequest(request)) return NextResponse.json({ error: "Request origin is not allowed" }, { status: 403 });
  if (!(await authenticatedUser())) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { clientId?: string };
  const clientId = typeof body.clientId === "string" ? body.clientId.trim() : "";
  if (!clientId || clientId.length > 512) return NextResponse.json({ error: "A valid clientId is required" }, { status: 400 });
  await revokeOAuthClient(clientId);
  return NextResponse.json({ ok: true });
}
