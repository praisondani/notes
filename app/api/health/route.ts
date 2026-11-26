import { NextResponse } from "next/server";
import { loadWorkspaceSnapshot } from "@/lib/workspace-store";
import { isAuthConfigurationReady } from "@/lib/auth";

export async function GET(): Promise<Response> {
  try {
    if (!isAuthConfigurationReady()) throw new Error("AUTH_SECRET is not configured");
    await loadWorkspaceSnapshot();
    return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  }
}
