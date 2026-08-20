import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { seedWorkspace } from "@/lib/seed";
import { ensureWorkspace } from "@/lib/notes";
import type { Workspace } from "@/lib/types";

function dataPath(): string {
  const root = process.env.DATA_DIR?.trim() || path.join(process.cwd(), "data");
  return path.resolve(root, "workspace.json");
}

export async function loadWorkspace(): Promise<Workspace> {
  const filename = dataPath();
  try {
    const raw = await readFile(filename, "utf8");
    return ensureWorkspace(JSON.parse(raw) as Workspace);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await saveWorkspace(seedWorkspace);
    return seedWorkspace;
  }
}

export async function saveWorkspace(workspace: Workspace): Promise<void> {
  const filename = dataPath();
  const directory = path.dirname(filename);
  await mkdir(directory, { recursive: true });
  const temporary = `${filename}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(ensureWorkspace(workspace), null, 2)}\n`, "utf8");
  await rename(temporary, filename);
}
