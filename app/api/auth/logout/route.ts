import { NextResponse } from "next/server";
import { clearAuthenticatedCookie } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST() {
  await clearAuthenticatedCookie();
  return NextResponse.json({ ok: true });
}
