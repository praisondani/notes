import { NextResponse } from "next/server";
import { clearAuthenticatedCookie, sameOriginRequest } from "@/lib/auth";

export async function POST(request: Request) {
  if (!sameOriginRequest(request)) return NextResponse.json({ error: "Request origin is not allowed" }, { status: 403 });
  await clearAuthenticatedCookie();
  return NextResponse.json({ ok: true });
}
