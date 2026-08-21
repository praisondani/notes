import { NextResponse } from "next/server";
import { sameOriginRequest, updateAccountProfile } from "@/lib/auth";

export async function POST(request: Request) {
  if (!sameOriginRequest(request)) return NextResponse.json({ error: "Request origin is not allowed" }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { username?: string; email?: string };
  try {
    const user = await updateAccountProfile({ username: typeof body.username === "string" ? body.username : "", email: typeof body.email === "string" ? body.email : "" });
    return NextResponse.json({ ok: true, user });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Profile update failed";
    return NextResponse.json({ error: message }, { status: message === "Authentication required" ? 401 : 400 });
  }
}
