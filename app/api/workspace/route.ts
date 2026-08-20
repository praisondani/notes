import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { ensureWorkspace } from "@/lib/notes";
import { loadWorkspace, saveWorkspace } from "@/lib/store";
import type { Workspace } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  return NextResponse.json(await loadWorkspace());
}

export async function PUT(request: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const payload = await request.json() as Workspace;
  if (payload?.version !== 1 || !Array.isArray(payload.notes) || !Array.isArray(payload.folders) || !Array.isArray(payload.groups)) {
    return NextResponse.json({ error: "Invalid workspace payload" }, { status: 400 });
  }
  const workspace = ensureWorkspace(payload);
  await saveWorkspace(workspace);
  return NextResponse.json(workspace);
}
