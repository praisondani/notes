import { NextResponse } from "next/server";
import { changeAccountPassword, sameOriginRequest } from "@/lib/auth";

export async function POST(request: Request) {
  if (!sameOriginRequest(request)) return NextResponse.json({ error: "Request origin is not allowed" }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { currentPassword?: string; newPassword?: string };
  try {
    await changeAccountPassword(typeof body.currentPassword === "string" ? body.currentPassword : "", typeof body.newPassword === "string" ? body.newPassword : "");
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Password update failed";
    return NextResponse.json({ error: message }, { status: message === "Authentication required" || message === "Current password is incorrect." ? 401 : 400 });
  }
}
