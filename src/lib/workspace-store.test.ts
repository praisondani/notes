import { chmod, mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedWorkspace } from "@/lib/seed";
import { loadWorkspaceSnapshot, saveWorkspace, updateWorkspace, WorkspaceConflictError } from "@/lib/workspace-store";

let dataDirectory = "";
const originalEnvironment = { ...process.env };

beforeEach(async () => {
  dataDirectory = await mkdtemp(path.join(os.tmpdir(), "notes-workspace-store-"));
  process.env.DATA_DIR = dataDirectory;
});

afterEach(async () => {
  process.env = { ...originalEnvironment };
  await rm(dataDirectory, { recursive: true, force: true });
});

describe("workspace storage", () => {
  it("rejects stale full-workspace snapshots after another writer updates the file", async () => {
    const initial = await loadWorkspaceSnapshot();
    await updateWorkspace((workspace) => ({
      ...workspace,
      notes: [...workspace.notes, { ...seedWorkspace.notes[0]!, id: "note-from-agent", title: "Agent edit" }],
    }));

    await expect(saveWorkspace(initial.workspace, initial.revision)).rejects.toBeInstanceOf(WorkspaceConflictError);
    const latest = await loadWorkspaceSnapshot();
    expect(latest.workspace.notes.some((note) => note.id === "note-from-agent")).toBe(true);
  });

  it("accepts an identical replay after the first save succeeded", async () => {
    const initial = await loadWorkspaceSnapshot();
    const nextWorkspace = {
      ...initial.workspace,
      notes: [...initial.workspace.notes, { ...seedWorkspace.notes[0]!, id: "retry-note", title: "Retry" }],
    };
    const committedRevision = await saveWorkspace(nextWorkspace, initial.revision);

    await expect(saveWorkspace(nextWorkspace, initial.revision)).resolves.toBe(committedRevision);
  });

  it("restricts workspace directory and file permissions on existing data", async () => {
    await chmod(dataDirectory, 0o755);
    await loadWorkspaceSnapshot();

    const directoryMode = (await stat(dataDirectory)).mode & 0o777;
    const fileMode = (await stat(path.join(dataDirectory, "workspace.json"))).mode & 0o777;
    expect(directoryMode).toBe(0o700);
    expect(fileMode).toBe(0o600);
  });
});
