import { NextResponse } from "next/server";
import { isAuthenticated, sameOriginRequest } from "@/lib/auth";
import { ensureWorkspace } from "@/lib/notes";
import { loadWorkspaceSnapshot, saveWorkspace, WorkspaceConflictError } from "@/lib/workspace-store";
import { readJsonBody, RequestBodyError } from "@/lib/request-body";
import type { WorkspaceInput } from "@/lib/types";

export async function GET() {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const snapshot = await loadWorkspaceSnapshot();
  return NextResponse.json(snapshot.workspace, { headers: { ETag: `"${snapshot.revision}"`, "Cache-Control": "private, no-store" } });
}

export async function PUT(request: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!sameOriginRequest(request)) return NextResponse.json({ error: "Request origin is not allowed" }, { status: 403 });
  const expectedRevision = request.headers.get("if-match")?.trim();
  if (!expectedRevision) return NextResponse.json({ error: "If-Match is required to save the workspace" }, { status: 428 });
  if (!/^"[a-f0-9]{64}"$/.test(expectedRevision)) return NextResponse.json({ error: "If-Match is invalid" }, { status: 400 });

  let payload: unknown;
  try {
    payload = await readJsonBody(request, 16 * 1024 * 1024);
  } catch (error) {
    const status = error instanceof RequestBodyError ? error.status : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request body" }, { status });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json({ error: "Invalid workspace payload" }, { status: 400 });
  }
  const candidate = payload as Record<string, unknown>;
  if (![1, 2].includes(candidate.version as number) || !Array.isArray(candidate.notes) || !Array.isArray(candidate.folders) || !Array.isArray(candidate.groups)) {
    return NextResponse.json({ error: "Invalid workspace payload" }, { status: 400 });
  }
  let workspace;
  try {
    workspace = ensureWorkspace(candidate as unknown as WorkspaceInput);
  } catch {
    return NextResponse.json({ error: "Invalid workspace payload" }, { status: 400 });
  }
  try {
    const revision = await saveWorkspace(workspace, expectedRevision.slice(1, -1));
    return NextResponse.json(workspace, { headers: { ETag: `"${revision}"`, "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof WorkspaceConflictError) {
      return NextResponse.json({ error: "Workspace changed since it was loaded. Reload the latest workspace before saving." }, { status: 412, headers: { "Cache-Control": "private, no-store" } });
    }
    return NextResponse.json({ error: "Workspace could not be saved" }, { status: 500 });
  }
}
