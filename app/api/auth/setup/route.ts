import { NextResponse } from "next/server";
import { sameOriginRequest, setupAccount } from "@/lib/auth";

export async function POST(request: Request) {
  if (!sameOriginRequest(request)) return NextResponse.json({ error: "Request origin is not allowed" }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { username?: string; email?: string; password?: string };
  try {
    const user = await setupAccount({ username: typeof body.username === "string" ? body.username : "", email: typeof body.email === "string" ? body.email : "", password: typeof body.password === "string" ? body.password : "" });
    return NextResponse.json({ ok: true, user });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Account setup failed";
    return NextResponse.json({ error: message }, { status: message === "Auth account already exists" ? 409 : 400 });
  }
}
