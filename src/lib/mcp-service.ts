import { createId, createNote as createBaseNote, getNotePreview, noteMatchesSearch } from "@/lib/notes";
import { loadWorkspace, updateWorkspace } from "@/lib/workspace-store";
import type {
  Attachment,
  AttachmentKind,
  ChecklistItem,
  Folder,
  Group,
  Note,
  NoteFilter,
  Workspace,
} from "@/lib/types";

const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_LENGTH = 100_000;
const MAX_TAGS = 50;
const MAX_TAG_LENGTH = 64;
const MAX_CHECKLIST_ITEMS = 100;
const MAX_CHECKLIST_TEXT_LENGTH = 1_000;
const MAX_ATTACHMENTS = 100;
const MAX_ATTACHMENT_NAME_LENGTH = 200;
const MAX_ATTACHMENT_MIME_LENGTH = 150;
const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024;
const MAX_FOLDER_NAME_LENGTH = 120;
const MAX_GROUP_NAME_LENGTH = 120;
const MAX_COLOR_LENGTH = 32;
const MAX_QUERY_LENGTH = 500;
const MAX_LIST_LIMIT = 100;
const MAX_SEARCH_LIMIT = 50;
const MAX_NOTE_CONTEXT_LENGTH = 4_000;

export class McpServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpServiceError";
  }
}

export type ChecklistInput = {
  id?: string;
  text: string;
  completed?: boolean;
};

export type AttachmentInput = {
  id?: string;
  kind: AttachmentKind;
  name: string;
  url: string;
  mimeType?: string;
  size?: number;
  objectKey?: string;
};

export type NoteCreateInput = {
  title?: string;
  content?: string;
  folderId?: string | null;
  groupId?: string | null;
  tags?: string[];
  checklist?: ChecklistInput[];
  attachments?: AttachmentInput[];
  pinned?: boolean;
  archived?: boolean;
};

export type NoteUpdateInput = Omit<NoteCreateInput, "title" | "content"> & {
  title?: string;
  content?: string;
};

export type ListNotesOptions = {
  search?: string;
  filter?: NoteFilter;
  folderId?: string | null;
  groupId?: string | null;
  includeArchived?: boolean;
  includeContent?: boolean;
  limit?: number;
  offset?: number;
};

export type SearchOptions = {
  includeArchived?: boolean;
  folderId?: string | null;
  groupId?: string | null;
  limit?: number;
  offset?: number;
};

export type NoteSummary = {
  id: string;
  title: string;
  preview: string;
  folderId: string | null;
  groupId: string | null;
  tags: string[];
  checklistCount: number;
  attachmentCount: number;
  pinned: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  content?: string;
};

export type SearchResult = {
  noteId: string;
  title: string;
  uri: string;
  score: number;
  matchedFields: string[];
  snippet: string;
  folderId: string | null;
  groupId: string | null;
  updatedAt: string;
};

export type RagResult = SearchResult & {
  context: string;
};

export type RagOptions = SearchOptions & {
  maxContextChars?: number;
};

export type FolderInput = {
  name: string;
  parentId?: string | null;
  color?: string;
};

export type FolderUpdateInput = Partial<FolderInput> & {
  position?: number;
};

export type GroupInput = {
  name: string;
  color?: string;
};

export type GroupUpdateInput = Partial<GroupInput> & {
  position?: number;
};

function fail(message: string): never {
  throw new McpServiceError(message);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function textValue(value: unknown, label: string, maxLength: number, allowEmpty = false): string {
  if (typeof value !== "string") fail(`${label} must be text`);
  if (value.length > maxLength) fail(`${label} is too long`);
  if (!allowEmpty && value.trim().length === 0) fail(`${label} is required`);
  return value;
}

function optionalId(value: unknown, label: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return textValue(value, label, 200);
}

function boundedInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    fail(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return value as number;
}

function normalizeQuery(value: unknown): string {
  const query = textValue(value ?? "", "Query", MAX_QUERY_LENGTH, true).trim();
  return query;
}

function normalizeLimit(value: unknown, fallback: number, maximum: number): number {
  return value === undefined ? fallback : boundedInteger(value, "Limit", 1, maximum);
}

function normalizeOffset(value: unknown): number {
  return value === undefined ? 0 : boundedInteger(value, "Offset", 0, Number.MAX_SAFE_INTEGER);
}

function normalizeTags(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_TAGS) fail(`Tags must contain no more than ${MAX_TAGS} items`);
  const tags = value.map((tag) => textValue(tag, "Tag", MAX_TAG_LENGTH).trim().toLocaleLowerCase());
  return [...new Set(tags)];
}

function normalizeChecklist(value: unknown): ChecklistItem[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_CHECKLIST_ITEMS) {
    fail(`Checklist must contain no more than ${MAX_CHECKLIST_ITEMS} items`);
  }
  return value.map((item) => {
    if (!item || typeof item !== "object") fail("Checklist items must be objects");
    const candidate = item as ChecklistInput;
    const id = candidate.id === undefined ? createId("check") : textValue(candidate.id, "Checklist item ID", 200);
    const text = textValue(candidate.text, "Checklist item text", MAX_CHECKLIST_TEXT_LENGTH).trim();
    if (candidate.completed !== undefined && typeof candidate.completed !== "boolean") {
      fail("Checklist item completed must be a boolean");
    }
    return { id, text, completed: candidate.completed ?? false };
  });
}

function isSafeAttachmentUrl(url: string): boolean {
  if (url.startsWith("/api/uploads/") && !url.includes("..") && !url.includes("\\")) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function normalizeAttachments(value: unknown): Attachment[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) {
    fail(`Attachments must contain no more than ${MAX_ATTACHMENTS} items`);
  }
  return value.map((item) => {
    if (!item || typeof item !== "object") fail("Attachments must be objects");
    const candidate = item as AttachmentInput;
    if (!["image", "file", "link"].includes(candidate.kind)) fail("Attachment kind is invalid");
    const name = textValue(candidate.name, "Attachment name", MAX_ATTACHMENT_NAME_LENGTH).trim();
    const url = textValue(candidate.url, "Attachment URL", 4_096).trim();
    if (!isSafeAttachmentUrl(url)) fail("Attachment URL must use http, https, or the local upload path");
    if (candidate.mimeType !== undefined) textValue(candidate.mimeType, "Attachment MIME type", MAX_ATTACHMENT_MIME_LENGTH);
    if (candidate.size !== undefined) boundedInteger(candidate.size, "Attachment size", 0, MAX_ATTACHMENT_SIZE);
    if (candidate.objectKey !== undefined) {
      const objectKey = textValue(candidate.objectKey, "Attachment object key", 512);
      if (objectKey.includes("..") || objectKey.includes("\\") || objectKey.startsWith("/")) {
        fail("Attachment object key is invalid");
      }
    }
    return {
      id: candidate.id === undefined ? createId("attachment") : textValue(candidate.id, "Attachment ID", 200),
      kind: candidate.kind,
      name,
      url,
      ...(candidate.mimeType === undefined ? {} : { mimeType: candidate.mimeType }),
      ...(candidate.size === undefined ? {} : { size: candidate.size }),
      ...(candidate.objectKey === undefined ? {} : { objectKey: candidate.objectKey }),
    };
  });
}

function normalizeColor(value: unknown, fallback: string): string {
  if (value === undefined) return fallback;
  const color = textValue(value, "Color", MAX_COLOR_LENGTH).trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(color)) fail("Color contains unsupported characters");
  return color;
}

function validateFolderReference(workspace: Workspace, folderId: string | null | undefined): void {
  if (folderId !== undefined && folderId !== null && !workspace.folders.some((folder) => folder.id === folderId)) {
    fail("Folder not found");
  }
}

function validateGroupReference(workspace: Workspace, groupId: string | null | undefined): void {
  if (groupId !== undefined && groupId !== null && !workspace.groups.some((group) => group.id === groupId)) {
    fail("Group not found");
  }
}

function normalizeNotePatch(input: NoteCreateInput | NoteUpdateInput, workspace: Workspace): Partial<Note> {
  const patch: Partial<Note> = {};
  if (input.title !== undefined) patch.title = textValue(input.title, "Title", MAX_TITLE_LENGTH).trim();
  if (input.content !== undefined) patch.content = textValue(input.content, "Content", MAX_CONTENT_LENGTH, true);
  if (input.folderId !== undefined) {
    patch.folderId = optionalId(input.folderId, "Folder ID") ?? null;
    validateFolderReference(workspace, patch.folderId);
  }
  if (input.groupId !== undefined) {
    patch.groupId = optionalId(input.groupId, "Group ID") ?? null;
    validateGroupReference(workspace, patch.groupId);
  }
  if (input.tags !== undefined) patch.tags = normalizeTags(input.tags);
  if (input.checklist !== undefined) patch.checklist = normalizeChecklist(input.checklist);
  if (input.attachments !== undefined) patch.attachments = normalizeAttachments(input.attachments);
  if (input.pinned !== undefined) {
    if (typeof input.pinned !== "boolean") fail("Pinned must be a boolean");
    patch.pinned = input.pinned;
  }
  if (input.archived !== undefined) {
    if (typeof input.archived !== "boolean") fail("Archived must be a boolean");
    patch.archived = input.archived;
  }
  return patch;
}

function summary(note: Note, includeContent: boolean): NoteSummary {
  return {
    id: note.id,
    title: note.title,
    preview: getNotePreview(note).slice(0, 280),
    folderId: note.folderId,
    groupId: note.groupId,
    tags: [...note.tags],
    checklistCount: note.checklist.length,
    attachmentCount: note.attachments.length,
    pinned: note.pinned,
    archived: note.archived,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    ...(includeContent ? { content: note.content.slice(0, MAX_CONTENT_LENGTH) } : {}),
  };
}

function sortedNotes(notes: Note[]): Note[] {
  return [...notes].sort((left, right) => {
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
    const updatedDifference = new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    return updatedDifference || left.position - right.position;
  });
}

function filterNoteCollection(notes: Note[], options: ListNotesOptions): Note[] {
  const search = normalizeQuery(options.search ?? "");
  const filter = options.filter ?? "all";
  let filtered = notes.filter((note) => options.includeArchived || !note.archived);
  if (filter === "archived") filtered = notes.filter((note) => note.archived);
  if (filter === "inbox") filtered = filtered.filter((note) => note.folderId === null);
  if (filter === "pinned") filtered = filtered.filter((note) => note.pinned);
  if (filter === "links") filtered = filtered.filter((note) => note.attachments.some((attachment) => attachment.kind === "link"));
  if (filter === "files") filtered = filtered.filter((note) => note.attachments.some((attachment) => attachment.kind !== "link"));
  if (options.folderId !== undefined) filtered = filtered.filter((note) => note.folderId === options.folderId);
  if (options.groupId !== undefined) filtered = filtered.filter((note) => note.groupId === options.groupId);
  return sortedNotes(filtered.filter((note) => noteMatchesSearch(note, search)));
}

export async function getWorkspaceSnapshot(): Promise<Workspace> {
  return clone(await loadWorkspace());
}

export async function listNotes(options: ListNotesOptions = {}): Promise<{
  notes: NoteSummary[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}> {
  const workspace = await loadWorkspace();
  const limit = normalizeLimit(options.limit, 20, MAX_LIST_LIMIT);
  const offset = normalizeOffset(options.offset);
  const filtered = filterNoteCollection(workspace.notes, options);
  const page = filtered.slice(offset, offset + limit);
  return {
    notes: page.map((note) => summary(note, options.includeContent === true)),
    total: filtered.length,
    limit,
    offset,
    hasMore: offset + page.length < filtered.length,
  };
}

export async function getNoteRecord(noteId: string): Promise<Note> {
  const id = textValue(noteId, "Note ID", 200);
  const note = (await loadWorkspace()).notes.find((candidate) => candidate.id === id);
  if (!note) fail("Note not found");
  return clone(note);
}

export async function createNoteRecord(input: NoteCreateInput = {}): Promise<Note> {
  return updateWorkspace((workspace) => {
    const patch = normalizeNotePatch(input, workspace);
    const note = { ...createBaseNote(new Date(), (patch.title as string | undefined) ?? "Untitled note"), ...patch };
    note.position = workspace.notes.length;
    return { ...workspace, notes: [...workspace.notes, note] };
  }).then((workspace) => clone(workspace.notes[workspace.notes.length - 1]));
}

export async function updateNoteRecord(noteId: string, input: NoteUpdateInput): Promise<Note> {
  const id = textValue(noteId, "Note ID", 200);
  let updated: Note | undefined;
  const workspace = await updateWorkspace((current) => {
    const existing = current.notes.find((note) => note.id === id);
    if (!existing) fail("Note not found");
    const patch = normalizeNotePatch(input, current);
    updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    return { ...current, notes: current.notes.map((note) => note.id === id ? updated as Note : note) };
  });
  return clone(updated ?? workspace.notes.find((note) => note.id === id) as Note);
}

export async function deleteNoteRecord(noteId: string): Promise<{ id: string; deleted: true }> {
  const id = textValue(noteId, "Note ID", 200);
  await updateWorkspace((workspace) => {
    if (!workspace.notes.some((note) => note.id === id)) fail("Note not found");
    return { ...workspace, notes: workspace.notes.filter((note) => note.id !== id) };
  });
  return { id, deleted: true };
}

export async function addNoteAttachmentRecord(noteId: string, input: AttachmentInput): Promise<Note> {
  const id = textValue(noteId, "Note ID", 200);
  const attachment = normalizeAttachments([input])[0];
  if (!attachment) fail("Attachment is required");
  let updated: Note | undefined;
  const workspace = await updateWorkspace((current) => {
    const existing = current.notes.find((note) => note.id === id);
    if (!existing) fail("Note not found");
    if (existing.attachments.length >= MAX_ATTACHMENTS) fail(`Attachments must contain no more than ${MAX_ATTACHMENTS} items`);
    updated = { ...existing, attachments: [...existing.attachments, attachment], updatedAt: new Date().toISOString() };
    return { ...current, notes: current.notes.map((note) => note.id === id ? updated as Note : note) };
  });
  return clone(updated ?? workspace.notes.find((note) => note.id === id) as Note);
}

export async function removeNoteAttachmentRecord(noteId: string, attachmentId: string): Promise<Note> {
  const id = textValue(noteId, "Note ID", 200);
  const targetId = textValue(attachmentId, "Attachment ID", 200);
  let updated: Note | undefined;
  const workspace = await updateWorkspace((current) => {
    const existing = current.notes.find((note) => note.id === id);
    if (!existing) fail("Note not found");
    if (!existing.attachments.some((attachment) => attachment.id === targetId)) fail("Attachment not found");
    updated = { ...existing, attachments: existing.attachments.filter((attachment) => attachment.id !== targetId), updatedAt: new Date().toISOString() };
    return { ...current, notes: current.notes.map((note) => note.id === id ? updated as Note : note) };
  });
  return clone(updated ?? workspace.notes.find((note) => note.id === id) as Note);
}

function tokenize(value: string): string[] {
  return [...new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [])].slice(0, 24);
}

function noteFields(note: Note): Array<{ name: string; text: string; weight: number }> {
  return [
    { name: "title", text: note.title, weight: 8 },
    { name: "content", text: note.content, weight: 2 },
    { name: "tags", text: note.tags.join(" "), weight: 6 },
    { name: "checklist", text: note.checklist.map((item) => item.text).join(" "), weight: 3 },
    { name: "attachments", text: note.attachments.map((attachment) => `${attachment.name} ${attachment.url}`).join(" "), weight: 1 },
  ];
}

function makeSnippet(note: Note, terms: string[]): string {
  const sources = [note.content, note.title, note.tags.join(" "), note.checklist.map((item) => item.text).join(" ")];
  for (const source of sources) {
    const lower = source.toLocaleLowerCase();
    const matchIndex = terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0).sort((a, b) => a - b)[0];
    if (matchIndex !== undefined) {
      const start = Math.max(0, matchIndex - 120);
      return source.slice(start, start + 360).replace(/\s+/g, " ").trim();
    }
  }
  return getNotePreview(note).slice(0, 360);
}

export function rankNotes(notes: Note[], query: string, options: SearchOptions = {}): SearchResult[] {
  const normalizedQuery = normalizeQuery(query);
  const terms = tokenize(normalizedQuery);
  if (!terms.length) return [];
  const phrase = normalizedQuery.toLocaleLowerCase();
  const filtered = notes.filter((note) => {
    if (!options.includeArchived && note.archived) return false;
    if (options.folderId !== undefined && note.folderId !== options.folderId) return false;
    if (options.groupId !== undefined && note.groupId !== options.groupId) return false;
    return true;
  });
  const ranked = filtered.flatMap((note) => {
    const matchedFields = new Set<string>();
    let score = 0;
    for (const field of noteFields(note)) {
      const lower = field.text.toLocaleLowerCase();
      let fieldMatches = 0;
      for (const term of terms) {
        if (lower.includes(term)) fieldMatches += 1;
      }
      if (fieldMatches) {
        matchedFields.add(field.name);
        score += fieldMatches * field.weight;
      }
    }
    if (!score) return [];
    if (note.title.toLocaleLowerCase().includes(phrase)) score += 12;
    if (note.content.toLocaleLowerCase().includes(phrase)) score += 6;
    if (note.pinned) score += 0.5;
    return [{
      noteId: note.id,
      title: note.title,
      uri: `notes://notes/${encodeURIComponent(note.id)}`,
      score,
      matchedFields: [...matchedFields],
      snippet: makeSnippet(note, terms),
      folderId: note.folderId,
      groupId: note.groupId,
      updatedAt: note.updatedAt,
    } satisfies SearchResult];
  });
  return ranked.sort((left, right) => right.score - left.score || new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
}

export async function searchNotes(query: string, options: SearchOptions = {}): Promise<{
  query: string;
  results: SearchResult[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}> {
  const workspace = await loadWorkspace();
  const limit = normalizeLimit(options.limit, 10, MAX_SEARCH_LIMIT);
  const offset = normalizeOffset(options.offset);
  const ranked = rankNotes(workspace.notes, query, options);
  const results = ranked.slice(offset, offset + limit);
  return { query: normalizeQuery(query), results, total: ranked.length, limit, offset, hasMore: offset + results.length < ranked.length };
}

function ragContext(note: Note): string {
  const parts = [
    note.content,
    note.checklist.length ? `Checklist:\n${note.checklist.map((item) => `- [${item.completed ? "x" : " "}] ${item.text}`).join("\n")}` : "",
    note.tags.length ? `Tags: ${note.tags.join(", ")}` : "",
    note.attachments.length ? `Attachments:\n${note.attachments.map((attachment) => `- ${attachment.name}: ${attachment.url}`).join("\n")}` : "",
  ].filter(Boolean);
  return parts.join("\n\n").slice(0, MAX_NOTE_CONTEXT_LENGTH);
}

export async function ragQuery(query: string, options: RagOptions = {}): Promise<{
  query: string;
  results: RagResult[];
  total: number;
  context: string;
}> {
  const workspace = await loadWorkspace();
  const limit = normalizeLimit(options.limit, 5, 20);
  const maxContextChars = options.maxContextChars === undefined
    ? 12_000
    : boundedInteger(options.maxContextChars, "Max context characters", 100, 50_000);
  const allRanked = rankNotes(workspace.notes, query, options);
  const ranked = allRanked.slice(0, limit);
  let remaining = maxContextChars;
  const results: RagResult[] = [];
  const blocks: string[] = [];
  for (const result of ranked) {
    const note = workspace.notes.find((candidate) => candidate.id === result.noteId);
    if (!note || remaining <= 0) continue;
    const rawBlock = `Source: ${result.uri}\nTitle: ${note.title}\n\n${ragContext(note)}`;
    const block = rawBlock.slice(0, remaining);
    if (!block) break;
    remaining -= block.length;
    blocks.push(block);
    results.push({ ...result, context: block });
  }
  return { query: normalizeQuery(query), results, total: allRanked.length, context: blocks.join("\n\n---\n\n").slice(0, maxContextChars) };
}

export async function listFolders(): Promise<Folder[]> {
  return clone((await loadWorkspace()).folders);
}

export async function createFolderRecord(input: FolderInput): Promise<Folder> {
  let created: Folder | undefined;
  const workspace = await updateWorkspace((current) => {
    const name = textValue(input.name, "Folder name", MAX_FOLDER_NAME_LENGTH).trim();
    const parentId = optionalId(input.parentId, "Parent folder ID") ?? null;
    if (parentId !== null && !current.folders.some((folder) => folder.id === parentId)) fail("Parent folder not found");
    created = { id: createId("folder"), name, parentId, color: normalizeColor(input.color, "slate"), position: current.folders.length };
    return { ...current, folders: [...current.folders, created] };
  });
  return clone(created ?? workspace.folders[workspace.folders.length - 1]);
}

function validateParent(folderId: string, parentId: string | null, folders: Folder[]): void {
  if (parentId === folderId) fail("A folder cannot contain itself");
  let currentId = parentId;
  const visited = new Set<string>();
  while (currentId) {
    if (visited.has(currentId)) fail("Folder hierarchy contains a cycle");
    visited.add(currentId);
    if (currentId === folderId) fail("A folder cannot be moved into its descendant");
    currentId = folders.find((folder) => folder.id === currentId)?.parentId ?? null;
  }
}

export async function updateFolderRecord(folderId: string, input: FolderUpdateInput): Promise<Folder> {
  const id = textValue(folderId, "Folder ID", 200);
  let updated: Folder | undefined;
  const workspace = await updateWorkspace((current) => {
    const existing = current.folders.find((folder) => folder.id === id);
    if (!existing) fail("Folder not found");
    const parentId = input.parentId === undefined ? existing.parentId : optionalId(input.parentId, "Parent folder ID") ?? null;
    if (parentId !== null && !current.folders.some((folder) => folder.id === parentId)) fail("Parent folder not found");
    validateParent(id, parentId, current.folders);
    const position = input.position === undefined ? existing.position : boundedInteger(input.position, "Position", 0, Number.MAX_SAFE_INTEGER);
    updated = {
      ...existing,
      ...(input.name === undefined ? {} : { name: textValue(input.name, "Folder name", MAX_FOLDER_NAME_LENGTH).trim() }),
      parentId,
      ...(input.color === undefined ? {} : { color: normalizeColor(input.color, existing.color) }),
      position,
    };
    return { ...current, folders: current.folders.map((folder) => folder.id === id ? updated as Folder : folder) };
  });
  return clone(updated ?? workspace.folders.find((folder) => folder.id === id) as Folder);
}

export async function deleteFolderRecord(folderId: string): Promise<{ id: string; deleted: true; detachedNoteCount: number; detachedChildCount: number }> {
  const id = textValue(folderId, "Folder ID", 200);
  let detachedNoteCount = 0;
  let detachedChildCount = 0;
  await updateWorkspace((workspace) => {
    if (!workspace.folders.some((folder) => folder.id === id)) fail("Folder not found");
    detachedNoteCount = workspace.notes.filter((note) => note.folderId === id).length;
    detachedChildCount = workspace.folders.filter((folder) => folder.parentId === id).length;
    return {
      ...workspace,
      folders: workspace.folders.filter((folder) => folder.id !== id).map((folder) => folder.parentId === id ? { ...folder, parentId: null } : folder),
      notes: workspace.notes.map((note) => note.folderId === id ? { ...note, folderId: null, updatedAt: new Date().toISOString() } : note),
    };
  });
  return { id, deleted: true, detachedNoteCount, detachedChildCount };
}

export async function listGroups(): Promise<Group[]> {
  return clone((await loadWorkspace()).groups);
}

export async function createGroupRecord(input: GroupInput): Promise<Group> {
  let created: Group | undefined;
  const workspace = await updateWorkspace((current) => {
    created = { id: createId("group"), name: textValue(input.name, "Group name", MAX_GROUP_NAME_LENGTH).trim(), color: normalizeColor(input.color, "slate"), position: current.groups.length };
    return { ...current, groups: [...current.groups, created] };
  });
  return clone(created ?? workspace.groups[workspace.groups.length - 1]);
}

export async function updateGroupRecord(groupId: string, input: GroupUpdateInput): Promise<Group> {
  const id = textValue(groupId, "Group ID", 200);
  let updated: Group | undefined;
  const workspace = await updateWorkspace((current) => {
    const existing = current.groups.find((group) => group.id === id);
    if (!existing) fail("Group not found");
    updated = {
      ...existing,
      ...(input.name === undefined ? {} : { name: textValue(input.name, "Group name", MAX_GROUP_NAME_LENGTH).trim() }),
      ...(input.color === undefined ? {} : { color: normalizeColor(input.color, existing.color) }),
      position: input.position === undefined ? existing.position : boundedInteger(input.position, "Position", 0, Number.MAX_SAFE_INTEGER),
    };
    return { ...current, groups: current.groups.map((group) => group.id === id ? updated as Group : group) };
  });
  return clone(updated ?? workspace.groups.find((group) => group.id === id) as Group);
}

export async function deleteGroupRecord(groupId: string): Promise<{ id: string; deleted: true; detachedNoteCount: number }> {
  const id = textValue(groupId, "Group ID", 200);
  let detachedNoteCount = 0;
  await updateWorkspace((workspace) => {
    if (!workspace.groups.some((group) => group.id === id)) fail("Group not found");
    detachedNoteCount = workspace.notes.filter((note) => note.groupId === id).length;
    return {
      ...workspace,
      groups: workspace.groups.filter((group) => group.id !== id),
      notes: workspace.notes.map((note) => note.groupId === id ? { ...note, groupId: null, updatedAt: new Date().toISOString() } : note),
    };
  });
  return { id, deleted: true, detachedNoteCount };
}

export async function workspaceSummary(): Promise<{
  noteCount: number;
  activeNoteCount: number;
  archivedNoteCount: number;
  pinnedNoteCount: number;
  folderCount: number;
  groupCount: number;
  attachmentCount: number;
  updatedAt: string | null;
}> {
  const workspace = await loadWorkspace();
  const updatedAt = workspace.notes.reduce<string | null>((latest, note) => latest === null || note.updatedAt > latest ? note.updatedAt : latest, null);
  return {
    noteCount: workspace.notes.length,
    activeNoteCount: workspace.notes.filter((note) => !note.archived).length,
    archivedNoteCount: workspace.notes.filter((note) => note.archived).length,
    pinnedNoteCount: workspace.notes.filter((note) => note.pinned).length,
    folderCount: workspace.folders.length,
    groupCount: workspace.groups.length,
    attachmentCount: workspace.notes.reduce((total, note) => total + note.attachments.length, 0),
    updatedAt,
  };
}
