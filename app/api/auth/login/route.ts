import { NextResponse } from "next/server";
import { authEnabled, checkPassword, setAuthenticatedCookie } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!authEnabled()) return NextResponse.json({ ok: true });
  const body = await request.json().catch(() => ({})) as { password?: string };
  if (!body.password || !checkPassword(body.password)) return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  await setAuthenticatedCookie();
  return NextResponse.json({ ok: true });
}
