import { chmod, mkdir, open, readFile, rename, stat, unlink, utimes, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { seedWorkspace } from "@/lib/seed";
import { ensureWorkspace } from "@/lib/notes";
import type { Workspace } from "@/lib/types";

const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 10_000;
const STALE_LOCK_MS = 30_000;
const LOCK_HEARTBEAT_MS = 10_000;

export class WorkspaceConflictError extends Error {
  constructor() {
    super("Workspace changed since it was loaded.");
    this.name = "WorkspaceConflictError";
  }
}

export type WorkspaceSnapshot = {
  workspace: Workspace;
  revision: string;
};

let queuedOperation: Promise<unknown> = Promise.resolve();

function dataPath(): string {
  const root = process.env.DATA_DIR?.trim() || path.join(process.cwd(), "data");
  return path.resolve(/* turbopackIgnore: true */ root, "workspace.json");
}

async function secureWorkspaceDirectory(): Promise<void> {
  const directory = path.dirname(dataPath());
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (directory !== path.parse(directory).root) await chmod(directory, 0o700);
}

function lockPath(): string {
  return `${dataPath()}.lock`;
}

function cloneWorkspace(workspace: Workspace): Workspace {
  return structuredClone(workspace);
}

async function readWorkspaceFile(): Promise<Workspace> {
  const raw = await readFile(dataPath(), "utf8");
  await secureWorkspaceDirectory();
  await chmod(dataPath(), 0o600);
  return ensureWorkspace(JSON.parse(raw) as Workspace);
}

async function readWorkspaceSnapshotFile(): Promise<WorkspaceSnapshot> {
  const raw = await readFile(dataPath(), "utf8");
  await secureWorkspaceDirectory();
  await chmod(dataPath(), 0o600);
  return { workspace: ensureWorkspace(JSON.parse(raw) as Workspace), revision: createHash("sha256").update(raw).digest("hex") };
}

function serializeWorkspace(workspace: Workspace): string {
  return `${JSON.stringify(ensureWorkspace(workspace), null, 2)}\n`;
}

async function writeWorkspaceFile(workspace: Workspace): Promise<void> {
  const filename = dataPath();
  await secureWorkspaceDirectory();
  const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, serializeWorkspace(workspace), { encoding: "utf8", mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, filename);
    await chmod(filename, 0o600);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function waitForLock(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
}

function lockOwnerIsAlive(owner: string): boolean {
  const pid = Number(owner.split(" ", 1)[0]);
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function removeStaleLock(filename: string): Promise<boolean> {
  try {
    const before = await stat(filename);
    if (Date.now() - before.mtimeMs <= STALE_LOCK_MS) return false;
    const owner = (await readFile(filename, "utf8")).trim();
    if (lockOwnerIsAlive(owner)) return false;
    const current = await stat(filename);
    if (before.ino !== current.ino || before.mtimeMs !== current.mtimeMs) return false;
    if ((await readFile(filename, "utf8")).trim() !== owner || lockOwnerIsAlive(owner)) return false;
    await unlink(filename);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function acquireLock(): Promise<() => Promise<void>> {
  const filename = lockPath();
  const startedAt = Date.now();
  await mkdir(path.dirname(filename), { recursive: true });

  while (Date.now() - startedAt < LOCK_TIMEOUT_MS) {
    try {
      const handle = await open(filename, "wx", 0o600);
      const owner = `${process.pid} ${randomUUID()}`;
      try {
        await handle.writeFile(`${owner}\n`);
        await handle.close();
      } catch (error) {
        await handle.close().catch(() => undefined);
        await unlink(filename).catch(() => undefined);
        throw error;
      }
      const heartbeat = setInterval(() => {
        void readFile(filename, "utf8").then((currentOwner) => {
          if (currentOwner.trim() === owner) {
            const now = new Date();
            return utimes(filename, now, now);
          }
        }).catch(() => undefined);
      }, LOCK_HEARTBEAT_MS);
      heartbeat.unref();
      return async () => {
        clearInterval(heartbeat);
        const currentOwner = await readFile(filename, "utf8").catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return null;
          throw error;
        });
        if (currentOwner?.trim() === owner) await unlink(filename);
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (await removeStaleLock(filename)) continue;
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
  return (await loadWorkspaceSnapshot()).workspace;
}

export async function loadWorkspaceSnapshot(): Promise<WorkspaceSnapshot> {
  try {
    return await readWorkspaceSnapshotFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return withWorkspaceLock(async () => {
      try {
        return await readWorkspaceSnapshotFile();
      } catch (retryError) {
        if ((retryError as NodeJS.ErrnoException).code !== "ENOENT") throw retryError;
        const initial = cloneWorkspace(seedWorkspace);
        await writeWorkspaceFile(initial);
        return readWorkspaceSnapshotFile();
      }
    });
  }
}

export async function saveWorkspace(workspace: Workspace, expectedRevision: string): Promise<string> {
  return withWorkspaceLock(async () => {
    let currentRevision: string | null = null;
    let currentRaw: string | null = null;
    try {
      currentRaw = await readFile(dataPath(), "utf8");
      currentRevision = createHash("sha256").update(currentRaw).digest("hex");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const serialized = serializeWorkspace(workspace);
    if (currentRevision !== expectedRevision) {
      if (currentRaw !== null && serializeWorkspace(ensureWorkspace(JSON.parse(currentRaw) as Workspace)) === serialized) return currentRevision!;
      throw new WorkspaceConflictError();
    }
    await writeWorkspaceFile(workspace);
    return createHash("sha256").update(serialized).digest("hex");
  });
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
