import type { ChecklistItem, Folder, Note, NoteFilter, NoteQuery, Workspace, WorkspaceInput } from "@/lib/types";

export function createId(prefix: string): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  return `${prefix}-${random}`;
}

export function createNote(now = new Date(), title = "Untitled note"): Note {
  const timestamp = now.toISOString();
  return {
    id: createId("note"),
    title,
    content: "",
    folderId: null,
    groupId: null,
    tags: [],
    checklist: [],
    attachments: [],
    pinned: false,
    archived: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    position: 0,
  };
}

export function getNotePreview(note: Note): string {
  const text = note.content.replace(/\s+/g, " ").trim();
  if (text) return text;
  if (note.checklist.length) return `${note.checklist.length} checklist item${note.checklist.length === 1 ? "" : "s"}`;
  if (note.attachments.length) return `${note.attachments.length} attachment${note.attachments.length === 1 ? "" : "s"}`;
  return "No text yet";
}

export function firstSentence(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return "";
  const match = text.match(/^(.+?[.!?])(?:\s|$)/);
  return (match?.[1] ?? text).replace(/[.!?]+$/, "").slice(0, 120).trim();
}

export function withDerivedTitle(note: Note): Note {
  const title = note.title.trim();
  if (title && title.toLocaleLowerCase() !== "untitled note") return note;
  const derived = firstSentence(note.content);
  return derived ? { ...note, title: derived } : note;
}

export function isNoteEmpty(note: Note): boolean {
  const title = note.title.trim().toLocaleLowerCase();
  const hasTitle = title.length > 0 && title !== "untitled note";
  const hasChecklist = note.checklist.some((item) => item.text.trim().length > 0 || item.completed);
  return !hasTitle && !note.content.trim() && !hasChecklist && note.attachments.length === 0 && note.tags.length === 0;
}

export function noteMatchesSearch(note: Note, search: string): boolean {
  const query = search.trim().toLocaleLowerCase();
  if (!query) return true;
  const haystack = [
    note.title,
    note.content,
    note.tags.join(" "),
    note.attachments.map((attachment) => `${attachment.name} ${attachment.url}`).join(" "),
    note.checklist.map((item) => item.text).join(" "),
  ].join(" ").toLocaleLowerCase();
  return haystack.includes(query);
}

export function noteMatchesFilter(note: Note, filter: NoteFilter): boolean {
  switch (filter) {
    case "inbox":
      return note.folderId === null && !note.archived;
    case "pinned":
      return note.pinned && !note.archived;
    case "archived":
      return note.archived;
    case "links":
      return note.attachments.some((attachment) => attachment.kind === "link");
    case "files":
      return note.attachments.some((attachment) => attachment.kind !== "link");
    case "all":
    default:
      return !note.archived;
  }
}

export function filterNotes(notes: Note[], query: NoteQuery): Note[] {
  return notes
    .filter((note) => noteMatchesSearch(note, query.search))
    .filter((note) => noteMatchesFilter(note, query.filter))
    .filter((note) => query.folderId === null || note.folderId === query.folderId)
    .filter((note) => query.groupId === null || note.groupId === query.groupId)
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
}

export function updateNote(notes: Note[], noteId: string, patch: Partial<Note>, now = new Date()): Note[] {
  return notes.map((note) => note.id === noteId
    ? { ...note, ...patch, updatedAt: now.toISOString() }
    : note);
}

export function moveNote(notes: Note[], noteId: string, folderId: string | null, now = new Date()): Note[] {
  return updateNote(notes, noteId, { folderId }, now);
}

export function getFolderPath(folders: Folder[], folderId: string | null): Folder[] {
  if (folderId === null) return [];
  const foldersById = new Map(folders.map((folder) => [folder.id, folder]));
  const path: Folder[] = [];
  const visited = new Set<string>();
  let current = foldersById.get(folderId);

  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    path.unshift(current);
    current = current.parentId === null ? undefined : foldersById.get(current.parentId);
  }

  return path;
}

export function canMoveFolder(folders: Folder[], folderId: string, parentId: string | null): boolean {
  const folder = folders.find((candidate) => candidate.id === folderId);
  if (!folder) return false;
  if (parentId === null) return true;
  const parent = folders.find((candidate) => candidate.id === parentId);
  if (!parent || parent.id === folder.id || parent.groupId !== folder.groupId) return false;
  return !getFolderPath(folders, parent.id).some((candidate) => candidate.id === folder.id);
}

export function moveFolder(folders: Folder[], folderId: string, parentId: string | null): Folder[] {
  if (!canMoveFolder(folders, folderId, parentId)) return folders;
  return folders.map((folder) => folder.id === folderId ? { ...folder, parentId } : folder);
}

export function togglePinned(notes: Note[], noteId: string, now = new Date()): Note[] {
  return notes.map((note) => note.id === noteId
    ? { ...note, pinned: !note.pinned, updatedAt: now.toISOString() }
    : note);
}

export function toggleArchived(notes: Note[], noteId: string, now = new Date()): Note[] {
  return notes.map((note) => note.id === noteId
    ? { ...note, archived: !note.archived, updatedAt: now.toISOString() }
    : note);
}

export function reorderNotes(notes: Note[], sourceId: string, targetId: string, now = new Date()): Note[] {
  if (sourceId === targetId) return notes;
  const sourceIndex = notes.findIndex((note) => note.id === sourceId);
  const targetIndex = notes.findIndex((note) => note.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return notes;
  const next = [...notes];
  const [source] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, source);
  const timestamp = now.toISOString();
  return next.map((note, position) => ({ ...note, position, updatedAt: note.id === sourceId ? timestamp : note.updatedAt }));
}

export function reorderChecklist(items: ChecklistItem[], sourceId: string, targetId: string): ChecklistItem[] {
  if (sourceId === targetId) return items;
  const sourceIndex = items.findIndex((item) => item.id === sourceId);
  const targetIndex = items.findIndex((item) => item.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return items;
  const next = [...items];
  const [source] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, source);
  return next;
}

export function toggleChecklist(notes: Note[], noteId: string, itemId: string, now = new Date()): Note[] {
  return notes.map((note) => note.id === noteId
    ? {
        ...note,
        updatedAt: now.toISOString(),
        checklist: note.checklist.map((item) => item.id === itemId ? { ...item, completed: !item.completed } : item),
      }
    : note);
}

export function ensureWorkspace(workspace: WorkspaceInput): Workspace {
  const notes = Array.isArray(workspace.notes) ? workspace.notes : [];
  const groups = Array.isArray(workspace.groups) ? workspace.groups : [];
  const groupIds = new Set(groups.map((group) => group.id));
  const migratingLegacyFolders = (workspace.version ?? 1) < 2;
  const rawFolders = Array.isArray(workspace.folders) ? workspace.folders : [];
  const inferredGroupIds = new Map<string, string | null>();

  for (const folder of rawFolders) {
    const noteGroupIds = new Set(
      notes
        .filter((note) => note.folderId === folder.id && note.groupId !== null && groupIds.has(note.groupId))
        .map((note) => note.groupId),
    );
    inferredGroupIds.set(folder.id, noteGroupIds.size === 1 ? [...noteGroupIds][0] ?? null : null);
  }

  const folders = rawFolders.map((folder) => {
    const explicitGroupId = folder.groupId !== undefined && folder.groupId !== null && groupIds.has(folder.groupId)
      ? folder.groupId
      : null;
    const shouldInferGroup = migratingLegacyFolders || folder.groupId === undefined;
    const parentId = folder.parentId && folder.parentId !== folder.id && rawFolders.some((candidate) => candidate.id === folder.parentId)
      ? folder.parentId
      : null;
    return { ...folder, parentId, groupId: shouldInferGroup ? inferredGroupIds.get(folder.id) ?? explicitGroupId : explicitGroupId };
  });

  const folderMap = new Map(folders.map((folder) => [folder.id, folder]));
  for (const folder of folders) {
    const visited = new Set([folder.id]);
    let parentId = folder.parentId;
    while (parentId) {
      if (visited.has(parentId)) {
        folder.parentId = null;
        break;
      }
      visited.add(parentId);
      parentId = folderMap.get(parentId)?.parentId ?? null;
    }
  }

  for (let pass = 0; pass < folders.length; pass += 1) {
    let changed = false;
    for (const folder of folders) {
      const parent = folder.parentId === null ? undefined : folderMap.get(folder.parentId);
      if (!parent) continue;
      if (parent.groupId !== null && folder.groupId !== parent.groupId) {
        folder.groupId = parent.groupId;
        changed = true;
      } else if (parent.groupId === null && folder.groupId !== null) {
        folder.parentId = null;
        changed = true;
      }
    }
    if (!changed) break;
  }

  const normalizedNotes = notes.map((note) => {
    const folder = note.folderId === null ? undefined : folderMap.get(note.folderId);
    if (!folder) return note.folderId === null ? note : { ...note, folderId: null };
    if (folder.groupId !== null && note.groupId !== folder.groupId) return { ...note, groupId: folder.groupId };
    if (folder.groupId === null && note.groupId !== null) return { ...note, folderId: null };
    return note;
  });

  return { version: 2, notes: normalizedNotes, folders, groups };
}

export function workspaceHasNote(workspace: Workspace, noteId: string): boolean {
  return workspace.notes.some((note) => note.id === noteId);
}
