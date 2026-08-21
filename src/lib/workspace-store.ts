import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { seedWorkspace } from "@/lib/seed";
import { ensureWorkspace } from "@/lib/notes";
import type { Workspace } from "@/lib/types";

const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 10_000;
const STALE_LOCK_MS = 30_000;

let queuedOperation: Promise<unknown> = Promise.resolve();

function dataPath(): string {
  const root = process.env.DATA_DIR?.trim() || path.join(process.cwd(), "data");
  return path.resolve(/* turbopackIgnore: true */ root, "workspace.json");
}

function lockPath(): string {
  return `${dataPath()}.lock`;
}

function cloneWorkspace(workspace: Workspace): Workspace {
  return structuredClone(workspace);
}

async function readWorkspaceFile(): Promise<Workspace> {
  const raw = await readFile(dataPath(), "utf8");
  return ensureWorkspace(JSON.parse(raw) as Workspace);
}

async function writeWorkspaceFile(workspace: Workspace): Promise<void> {
  const filename = dataPath();
  const directory = path.dirname(filename);
  await mkdir(directory, { recursive: true });
  const temporary = `${filename}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(ensureWorkspace(workspace), null, 2)}\n`, "utf8");
  await rename(temporary, filename);
}

async function waitForLock(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
}

async function acquireLock(): Promise<() => Promise<void>> {
  const filename = lockPath();
  const startedAt = Date.now();
  await mkdir(path.dirname(filename), { recursive: true });

  while (Date.now() - startedAt < LOCK_TIMEOUT_MS) {
    try {
      const handle = await open(filename, "wx");
      await handle.writeFile(`${process.pid}\n`);
      await handle.close();
      return async () => {
        await unlink(filename).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const details = await stat(filename);
        if (Date.now() - details.mtimeMs > STALE_LOCK_MS) {
          await unlink(filename).catch(() => undefined);
          continue;
        }
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code !== "ENOENT") throw statError;
      }
      await waitForLock();
    }
  }

  throw new Error("Workspace is busy. Try again shortly.");
}

async function withWorkspaceLock<T>(operation: () => Promise<T>): Promise<T> {
  const next = queuedOperation.then(async () => {
    const release = await acquireLock();
    try {
      return await operation();
    } finally {
      await release();
    }
  });
  queuedOperation = next.then(() => undefined, () => undefined);
  return next as Promise<T>;
}

export async function loadWorkspace(): Promise<Workspace> {
  try {
    return await readWorkspaceFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return withWorkspaceLock(async () => {
      try {
        return await readWorkspaceFile();
      } catch (retryError) {
        if ((retryError as NodeJS.ErrnoException).code !== "ENOENT") throw retryError;
        const initial = cloneWorkspace(seedWorkspace);
        await writeWorkspaceFile(initial);
        return initial;
      }
    });
  }
}

export async function saveWorkspace(workspace: Workspace): Promise<void> {
  await withWorkspaceLock(() => writeWorkspaceFile(ensureWorkspace(workspace)));
}

export async function updateWorkspace(mutator: (workspace: Workspace) => Workspace | Promise<Workspace>): Promise<Workspace> {
  return withWorkspaceLock(async () => {
    let current: Workspace;
    try {
      current = await readWorkspaceFile();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      current = cloneWorkspace(seedWorkspace);
    }
    const next = ensureWorkspace(await mutator(current));
    await writeWorkspaceFile(next);
    return next;
  });
}
