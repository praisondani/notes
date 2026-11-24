import { createId, createNote as createBaseNote, getNotePreview, noteMatchesSearch } from "@/lib/notes";
import { detectSecret } from "@/lib/secrets-guard";
import { storeBytes } from "@/lib/storage";
import { loadWorkspace, updateWorkspace } from "@/lib/workspace-store";
import type {
  Attachment,
  AttachmentKind,
  ChecklistItem,
  ClientIdentity,
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

export type McpOperationContext = {
  source: "oauth" | "bearer" | "stdio" | "file" | "environment";
  clientId?: string;
  clientName?: string;
  label?: string;
};

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
  expectedUpdatedAt?: string;
};

export type NoteMutationResult = Note & {
  warning?: string;
};

export type AppendToNoteInput = {
  noteId: string;
  markdown: string;
  underHeading?: string;
  position?: "end" | "top_of_section";
};

const SECRET_WRITE_WARNING = "Looks like a secret; saved anyway. Prefer a password vault and store only where it lives.";

function secretWarningFor(text: string | undefined): string | undefined {
  if (!text) return undefined;
  return detectSecret(text).blocked ? SECRET_WRITE_WARNING : undefined;
}

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
  groupId?: string | null;
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

function createClientIdentity(context?: McpOperationContext): ClientIdentity | undefined {
  if (!context) return undefined;
  if (context.clientId && context.clientName) {
    return { clientId: context.clientId, clientName: context.clientName, source: context.source };
  }
  if (context.label) {
    return { clientId: "file-token", clientName: context.label, source: context.source };
  }
  const defaultName = context.source === "oauth" ? "OAuth Client" 
    : context.source === "stdio" ? "Local stdio" 
    : context.source === "file" ? "File Token"
    : context.source === "environment" ? "Environment Token"
    : "Bearer Token";
  return { clientId: context.source, clientName: defaultName, source: context.source };
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

function normalizeNotePatch(input: NoteCreateInput | NoteUpdateInput, workspace: Workspace, existing?: Note): Partial<Note> {
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
  if (input.folderId !== undefined || input.groupId !== undefined) {
    const nextFolderId = input.folderId === undefined ? existing?.folderId ?? null : patch.folderId ?? null;
    const folder = nextFolderId === null ? undefined : workspace.folders.find((candidate) => candidate.id === nextFolderId);
    const nextGroupId = input.groupId === undefined ? existing?.groupId ?? null : patch.groupId ?? null;
    if (folder && input.groupId === undefined) {
      patch.groupId = folder.groupId;
    } else if (folder && nextGroupId !== folder.groupId) {
      fail("Folder and group must belong to the same group");
    }
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

const AGENT_BRAIN_TAG = "agent-brain";
const AGENT_BRAIN_INDEX_TAG = "index";
const AGENT_BRIDGE_TAG = "agent-bridge";
const AGENT_BRAIN_INDEX_TITLE = "agent brain: start here";
const DEFAULT_AGENT_CONTEXT_CHARS = 12_000;
const DEFAULT_BRIDGE_ENTRIES = 12;

export type AgentContextOptions = {
  topic?: string;
  maxChars?: number;
  bridgeEntries?: number;
};

export type AgentContextNote = {
  id: string;
  title: string;
  tags: string[];
  content: string;
  updatedAt: string;
  truncated: boolean;
};

export type AgentContextResult = {
  index: AgentContextNote | null;
  notes: AgentContextNote[];
  bridge_entries: string[];
  topic_hits: Array<{ noteId: string; title: string; snippet: string; score: number }>;
  content: string;
  truncated: boolean;
  remaining_note_ids: string[];
  brain_version: string;
  updated_at: string;
  hint?: string;
};

function noteHasTag(note: Note, tag: string): boolean {
  return note.tags.some((value) => value.toLocaleLowerCase() === tag);
}

function findBrainIndex(notes: Note[]): Note | undefined {
  const tagged = notes.find((note) => !note.archived && noteHasTag(note, AGENT_BRAIN_TAG) && noteHasTag(note, AGENT_BRAIN_INDEX_TAG));
  if (tagged) return tagged;
  return notes.find((note) => !note.archived && note.title.trim().toLocaleLowerCase() === AGENT_BRAIN_INDEX_TITLE);
}

function truncateText(value: string, maxChars: number): { text: string; truncated: boolean } {
  if (value.length <= maxChars) return { text: value, truncated: false };
  return { text: value.slice(0, Math.max(0, maxChars - 1)).trimEnd() + "…", truncated: true };
}

function bridgeEntriesFrom(note: Note | undefined, limit: number): string[] {
  if (!note) return [];
  return note.content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-limit)
    .reverse();
}

export async function getAgentContext(options: AgentContextOptions = {}): Promise<AgentContextResult> {
  const workspace = await loadWorkspace();
  const maxChars = options.maxChars === undefined
    ? DEFAULT_AGENT_CONTEXT_CHARS
    : boundedInteger(options.maxChars, "Max characters", 100, 50_000);
  const bridgeLimit = options.bridgeEntries === undefined
    ? DEFAULT_BRIDGE_ENTRIES
    : boundedInteger(options.bridgeEntries, "Bridge entries", 1, 100);
  const topic = normalizeQuery(options.topic ?? "");

  const brainNotes = workspace.notes
    .filter((note) => !note.archived && noteHasTag(note, AGENT_BRAIN_TAG))
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  const index = findBrainIndex(workspace.notes);
  const bridge = workspace.notes.find((note) => !note.archived && noteHasTag(note, AGENT_BRIDGE_TAG));

  if (!index && brainNotes.length === 0) {
    return {
      index: null,
      notes: [],
      bridge_entries: bridgeEntriesFrom(bridge, bridgeLimit),
      topic_hits: [],
      content: "",
      truncated: false,
      remaining_note_ids: [],
      brain_version: "empty",
      updated_at: new Date(0).toISOString(),
      hint: "No agent brain notes yet. Create a pinned note titled \"Agent Brain: start here\" with tags agent-brain and index, then add profile/rules/projects/decisions notes tagged agent-brain.",
    };
  }

  const ordered = [
    ...(index ? [index] : []),
    ...brainNotes.filter((note) => note.id !== index?.id),
  ];
  const included: AgentContextNote[] = [];
  const remaining_note_ids: string[] = [];
  let remaining = maxChars;
  let truncated = false;
  const blocks: string[] = [];

  for (const note of ordered) {
    if (remaining <= 0) {
      remaining_note_ids.push(note.id);
      truncated = true;
      continue;
    }
    const header = `# ${note.title}\n`;
    const budget = Math.max(0, remaining - header.length);
    const body = truncateText(note.content, budget);
    const content = `${header}${body.text}`.trim();
    included.push({
      id: note.id,
      title: note.title,
      tags: [...note.tags],
      content: body.text,
      updatedAt: note.updatedAt,
      truncated: body.truncated,
    });
    blocks.push(content);
    remaining -= content.length + 2;
    if (body.truncated) {
      truncated = true;
      remaining_note_ids.push(...ordered.slice(ordered.indexOf(note) + 1).map((candidate) => candidate.id));
      break;
    }
  }

  const topic_hits = topic
    ? (await ragQuery(topic, { limit: 5, maxContextChars: Math.min(2_000, maxChars) })).results.map((result) => ({
      noteId: result.noteId,
      title: result.title,
      snippet: result.snippet,
      score: result.score,
    }))
    : [];

  if (topic_hits.length && remaining > 0) {
    const topicBlock = topic_hits
      .map((hit) => `- ${hit.title}: ${hit.snippet}`)
      .join("\n");
    const clipped = truncateText(`## Topic hits\n${topicBlock}`, remaining);
    blocks.push(clipped.text);
    remaining -= clipped.text.length;
    truncated = truncated || clipped.truncated;
  }

  const bridge_entries = bridgeEntriesFrom(bridge, bridgeLimit);
  if (bridge_entries.length && remaining > 0) {
    const bridgeBlock = bridge_entries.map((entry) => `- ${entry}`).join("\n");
    const clipped = truncateText(`## Bridge\n${bridgeBlock}`, remaining);
    blocks.push(clipped.text);
    truncated = truncated || clipped.truncated;
  }

  const updatedCandidates = [...ordered, ...(bridge ? [bridge] : [])];
  const updated_at = updatedCandidates
    .map((note) => note.updatedAt)
    .sort()
    .at(-1) ?? new Date(0).toISOString();
  const brain_version = `${updatedCandidates.length}:${updated_at}`;

  return {
    index: included.find((note) => note.id === index?.id) ?? null,
    notes: included,
    bridge_entries,
    topic_hits,
    content: blocks.join("\n\n").slice(0, maxChars),
    truncated,
    remaining_note_ids: [...new Set(remaining_note_ids)],
    brain_version,
    updated_at,
  };
}

export const REMEMBER_KINDS = ["fact", "preference", "decision", "project_status", "correction"] as const;
export type RememberKind = (typeof REMEMBER_KINDS)[number];

export type RememberInput = {
  statement: string;
  kind: RememberKind;
  topic?: string;
  source?: string;
  reason?: string;
};

export type RememberResult =
  | { status: "saved"; note_id: string; line: string }
  | { status: "duplicate"; note_id: string; existing: string };

function notesTimeZone(): string {
  return process.env.NOTES_TIME_ZONE?.trim() || "America/Chicago";
}

function formatNotesDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: notesTimeZone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function normalizeStatement(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function lexicalSimilarity(left: string, right: string): number {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  if (!leftTokens.size || !rightTokens.size) return 0;
  let overlap = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) overlap += 1;
  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function rememberTargetMeta(kind: RememberKind, topic?: string): { title: string; tags: string[]; section?: string } {
  switch (kind) {
    case "decision":
      return { title: "Agent Brain: decisions", tags: [AGENT_BRAIN_TAG, "decisions"] };
    case "project_status":
      return {
        title: "Agent Brain: projects",
        tags: [AGENT_BRAIN_TAG, "projects"],
        section: topic?.trim() || "General",
      };
    case "preference":
      return { title: "Agent Brain: rules", tags: [AGENT_BRAIN_TAG, "rules"] };
    case "correction":
    case "fact":
    default:
      return { title: "Agent Brain: profile", tags: [AGENT_BRAIN_TAG, "profile"] };
  }
}

function ensureBrainFolder(workspace: Workspace): { workspace: Workspace; folderId: string } {
  const existing = workspace.folders.find((folder) => folder.name.trim().toLocaleLowerCase() === "agent brain" && folder.groupId === null);
  if (existing) return { workspace, folderId: existing.id };
  const folder: Folder = {
    id: createId("folder"),
    name: "Agent Brain",
    parentId: null,
    groupId: null,
    color: "slate",
    position: workspace.folders.length,
  };
  return { workspace: { ...workspace, folders: [...workspace.folders, folder] }, folderId: folder.id };
}

function ensureBrainNote(workspace: Workspace, folderId: string, title: string, tags: string[]): { workspace: Workspace; note: Note } {
  const existing = workspace.notes.find((note) => !note.archived && note.title === title && noteHasTag(note, AGENT_BRAIN_TAG));
  if (existing) return { workspace, note: existing };
  const note = {
    ...createBaseNote(new Date(), title),
    folderId,
    tags: [...new Set(tags.map((tag) => tag.toLocaleLowerCase()))],
    content: "",
    position: workspace.notes.length,
  };
  return { workspace: { ...workspace, notes: [...workspace.notes, note] }, note };
}

function appendUnderHeading(content: string, heading: string, line: string): string {
  const marker = `## ${heading}`;
  const normalized = content.replace(/\s+$/u, "");
  if (!normalized.trim()) return `${marker}\n${line}\n`;
  const index = normalized.split(/\r?\n/).findIndex((entry) => entry.trim() === marker);
  if (index < 0) return `${normalized}\n\n${marker}\n${line}\n`;
  const lines = normalized.split(/\r?\n/);
  let insertAt = index + 1;
  while (insertAt < lines.length && !/^##\s+/.test(lines[insertAt] ?? "")) insertAt += 1;
  lines.splice(insertAt, 0, line);
  return `${lines.join("\n").replace(/\s+$/u, "")}\n`;
}

function markSuperseded(content: string, statement: string, date: string): string {
  const needle = normalizeStatement(statement);
  return content
    .split(/\r?\n/)
    .map((line) => {
      if (!line.trim() || /\(superseded \d{4}-\d{2}-\d{2}\)/.test(line)) return line;
      const body = line.replace(/^- \d{4}-\d{2}-\d{2} · [^:]+:\s*/, "");
      return normalizeStatement(body) === needle || lexicalSimilarity(body, statement) >= 0.85
        ? `${line.replace(/\s+$/u, "")} (superseded ${date})`
        : line;
    })
    .join("\n");
}

function statementBody(line: string): string {
  return line
    .replace(/^- \d{4}-\d{2}-\d{2} · [^:]+:\s*/, "")
    .replace(/\s*\(superseded \d{4}-\d{2}-\d{2}\)\s*$/, "")
    .trim();
}

export async function rememberNote(input: RememberInput, context?: McpOperationContext): Promise<RememberResult> {
  const statement = textValue(input.statement, "Statement", 1_000).trim();
  if (!REMEMBER_KINDS.includes(input.kind)) fail("Remember kind is invalid");
  const secret = detectSecret(statement);
  if (secret.blocked) fail(secret.message ?? "Looks like a secret; not saved.");

  const source = input.source === undefined ? undefined : textValue(input.source, "Source", 200).trim();
  const reason = input.reason === undefined ? undefined : textValue(input.reason, "Reason", 500).trim();
  const topic = input.topic === undefined ? undefined : textValue(input.topic, "Topic", 120).trim();
  const identity = createClientIdentity(context);
  const clientName = identity?.clientName || "Unknown agent";
  const date = formatNotesDate();
  const line = `- ${date} · ${clientName}${source ? ` · ${source}` : ""}: ${statement}${reason ? ` (${reason})` : ""}`;
  const target = rememberTargetMeta(input.kind, topic);
  const normalized = normalizeStatement(statement);
  let result: RememberResult | undefined;

  await updateWorkspace((workspace) => {
    const withFolder = ensureBrainFolder(workspace);
    const ensured = ensureBrainNote(withFolder.workspace, withFolder.folderId, target.title, target.tags);
    const note = ensured.note;
    const lines = note.content.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);

    const exact = lines.find((existing) => normalizeStatement(statementBody(existing)) === normalized);
    if (exact) {
      result = { status: "duplicate", note_id: note.id, existing: exact };
      return ensured.workspace;
    }

    const near = lines.find((existing) => lexicalSimilarity(statementBody(existing), statement) >= 0.85);
    if (near && input.kind !== "correction") {
      result = { status: "duplicate", note_id: note.id, existing: near };
      return ensured.workspace;
    }

    let nextContent = note.content;
    if (input.kind === "correction") {
      for (const existing of lines) {
        const body = statementBody(existing);
        if (lexicalSimilarity(body, statement) >= 0.4 || (reason && lexicalSimilarity(body, reason) >= 0.5)) {
          nextContent = markSuperseded(nextContent, body, date);
        }
      }
    }

    if (target.section) {
      nextContent = appendUnderHeading(nextContent, target.section, line);
    } else {
      const base = nextContent.replace(/\s+$/u, "");
      nextContent = `${base}${base ? "\n" : ""}${line}\n`;
    }

    const updatedBy = createClientIdentity(context);
    const updatedNote: Note = {
      ...note,
      content: nextContent,
      updatedAt: new Date().toISOString(),
      ...(updatedBy ? { updatedBy } : {}),
    };
    result = { status: "saved", note_id: note.id, line };
    return {
      ...ensured.workspace,
      notes: ensured.workspace.notes.map((candidate) => candidate.id === note.id ? updatedNote : candidate),
    };
  });

  if (!result) fail("Remember failed");
  return result;
}

export async function createNoteRecord(input: NoteCreateInput = {}, context?: McpOperationContext): Promise<NoteMutationResult> {
  const warning = secretWarningFor(input.content);
  return updateWorkspace((workspace) => {
    const patch = normalizeNotePatch(input, workspace);
    const createdBy = createClientIdentity(context);
    const note = { ...createBaseNote(new Date(), (patch.title as string | undefined) ?? "Untitled note"), ...patch, ...(createdBy ? { createdBy, updatedBy: createdBy } : {}) };
    note.position = workspace.notes.length;
    return { ...workspace, notes: [...workspace.notes, note] };
  }).then((workspace) => {
    const note = clone(workspace.notes[workspace.notes.length - 1]);
    return warning ? { ...note, warning } : note;
  });
}

export async function updateNoteRecord(noteId: string, input: NoteUpdateInput, context?: McpOperationContext): Promise<NoteMutationResult> {
  const id = textValue(noteId, "Note ID", 200);
  const expectedUpdatedAt = input.expectedUpdatedAt === undefined
    ? undefined
    : textValue(input.expectedUpdatedAt, "expected_updated_at", 64);
  const warning = secretWarningFor(input.content);
  let updated: Note | undefined;
  const updatedBy = createClientIdentity(context);
  const workspace = await updateWorkspace((current) => {
    const existing = current.notes.find((note) => note.id === id);
    if (!existing) fail("Note not found");
    if (expectedUpdatedAt !== undefined && existing.updatedAt !== expectedUpdatedAt) {
      fail("Conflict: note changed since expected_updated_at; refresh and retry");
    }
    const patch = normalizeNotePatch(input, current, existing);
    updated = { ...existing, ...patch, updatedAt: new Date().toISOString(), ...(updatedBy ? { updatedBy } : {}) };
    return { ...current, notes: current.notes.map((note) => note.id === id ? updated as Note : note) };
  });
  const note = clone(updated ?? workspace.notes.find((note) => note.id === id) as Note);
  return warning ? { ...note, warning } : note;
}

function appendMarkdownToContent(
  content: string,
  markdown: string,
  underHeading?: string,
  position: "end" | "top_of_section" = "end",
): string {
  const chunk = markdown.replace(/\s+$/u, "");
  if (!underHeading) {
    const base = content.replace(/\s+$/u, "");
    return `${base}${base ? "\n" : ""}${chunk}\n`;
  }
  const marker = `## ${underHeading}`;
  const normalized = content.replace(/\s+$/u, "");
  if (!normalized.trim()) return `${marker}\n${chunk}\n`;
  const lines = normalized.split(/\r?\n/);
  const index = lines.findIndex((entry) => entry.trim() === marker);
  if (index < 0) return `${normalized}\n\n${marker}\n${chunk}\n`;
  let sectionEnd = index + 1;
  while (sectionEnd < lines.length && !/^##\s+/.test(lines[sectionEnd] ?? "")) sectionEnd += 1;
  const insertAt = position === "top_of_section" ? index + 1 : sectionEnd;
  lines.splice(insertAt, 0, chunk);
  return `${lines.join("\n").replace(/\s+$/u, "")}\n`;
}

export async function appendToNote(input: AppendToNoteInput, context?: McpOperationContext): Promise<NoteMutationResult> {
  const id = textValue(input.noteId, "Note ID", 200);
  const markdown = textValue(input.markdown, "Markdown", 100_000);
  const underHeading = input.underHeading === undefined
    ? undefined
    : textValue(input.underHeading, "under_heading", 200);
  const position = input.position ?? "end";
  if (position !== "end" && position !== "top_of_section") fail("position must be end or top_of_section");
  const warning = secretWarningFor(markdown);
  let updated: Note | undefined;
  const updatedBy = createClientIdentity(context);
  const workspace = await updateWorkspace((current) => {
    const existing = current.notes.find((note) => note.id === id);
    if (!existing) fail("Note not found");
    updated = {
      ...existing,
      content: appendMarkdownToContent(existing.content, markdown, underHeading, position),
      updatedAt: new Date().toISOString(),
      ...(updatedBy ? { updatedBy } : {}),
    };
    return { ...current, notes: current.notes.map((note) => note.id === id ? updated as Note : note) };
  });
  const note = clone(updated ?? workspace.notes.find((note) => note.id === id) as Note);
  return warning ? { ...note, warning } : note;
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

const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/json",
]);

const MIME_EXTENSION: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/markdown": "md",
  "application/json": "json",
};

export type UploadNoteFileInput = {
  noteId: string;
  source: "url" | "base64";
  data: string;
  filename?: string;
  mimeType?: string;
  addAttachment?: boolean;
  appendMarkdown?: boolean;
};

export type UploadNoteFileResult = {
  url: string;
  markdown: string;
  kind: AttachmentKind;
  mimeType?: string;
  size?: number;
  objectKey?: string;
  attachmentId?: string;
  note?: Note;
};

function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

function normalizeUploadMimeType(value: string | undefined): string {
  const mimeType = (value ?? "").trim().toLowerCase();
  if (!mimeType || !ALLOWED_UPLOAD_MIME_TYPES.has(mimeType)) {
    fail(`Unsupported file type. Allowed types: ${[...ALLOWED_UPLOAD_MIME_TYPES].join(", ")}`);
  }
  return mimeType === "image/jpg" ? "image/jpeg" : mimeType;
}

function parseDataUrl(value: string): { mimeType: string; buffer: Buffer } {
  const match = /^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(value.trim());
  if (!match) fail("Invalid base64 data. Expected format: data:<mime>;base64,<data>");
  const mimeType = normalizeUploadMimeType(match[1]);
  const buffer = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  if (!buffer.length) fail("Base64 payload is empty");
  if (buffer.length > MAX_ATTACHMENT_SIZE) {
    fail(`File size ${buffer.length} bytes exceeds maximum ${MAX_ATTACHMENT_SIZE} bytes`);
  }
  return { mimeType, buffer };
}

function markdownForUpload(kind: AttachmentKind, name: string, url: string): string {
  return kind === "image" ? `![${name}](${url})` : `[${name}](${url})`;
}

export async function uploadNoteFile(input: UploadNoteFileInput, context?: McpOperationContext): Promise<UploadNoteFileResult> {
  const noteId = textValue(input.noteId, "Note ID", 200);
  const addAttachment = input.addAttachment !== false;
  const appendMarkdown = input.appendMarkdown === true;

  if (input.source === "url") {
    const url = textValue(input.data, "File URL", 4_096).trim();
    if (!url.startsWith("https://") && !url.startsWith("http://")) {
      fail("File URL must use http or https protocol");
    }
    const mimeType = input.mimeType ? normalizeUploadMimeType(input.mimeType) : undefined;
    const kind: AttachmentKind = mimeType && isImageMimeType(mimeType) ? "image" : mimeType ? "file" : "link";
    const name = textValue(input.filename?.trim() || (kind === "image" ? "Image" : "File"), "Filename", MAX_ATTACHMENT_NAME_LENGTH).trim();
    const markdown = markdownForUpload(kind === "link" ? "file" : kind, name, url);
    let note: Note | undefined;
    let attachmentId: string | undefined;
    if (addAttachment) {
      note = await addNoteAttachmentRecord(noteId, {
        kind,
        name,
        url,
        ...(mimeType ? { mimeType } : {}),
      });
      attachmentId = note.attachments.at(-1)?.id;
    } else if (!(await loadWorkspace()).notes.some((candidate) => candidate.id === noteId)) {
      fail("Note not found");
    }
    if (appendMarkdown) {
      note = await updateNoteRecord(noteId, { content: `${(note ?? await getNoteRecord(noteId)).content}${markdown.startsWith("\n") ? "" : "\n"}${markdown}\n` }, context);
    }
    return {
      url,
      markdown,
      kind,
      ...(mimeType ? { mimeType } : {}),
      ...(attachmentId ? { attachmentId } : {}),
      ...(note ? { note } : {}),
    };
  }

  if (input.source !== "base64") fail("Invalid source type. Must be 'url' or 'base64'");

  const parsed = parseDataUrl(input.data);
  const mimeType = input.mimeType ? normalizeUploadMimeType(input.mimeType) : parsed.mimeType;
  if (input.mimeType && normalizeUploadMimeType(input.mimeType) !== parsed.mimeType) {
    fail("mime_type must match the base64 data URL type");
  }
  const extension = MIME_EXTENSION[mimeType] ?? "bin";
  const name = textValue(input.filename?.trim() || `upload.${extension}`, "Filename", MAX_ATTACHMENT_NAME_LENGTH).trim();
  const stored = await storeBytes(name, mimeType, parsed.buffer);
  const kind: AttachmentKind = isImageMimeType(mimeType) ? "image" : "file";
  const markdown = markdownForUpload(kind, name, stored.url);
  let note: Note | undefined;
  let attachmentId: string | undefined;
  if (addAttachment) {
    note = await addNoteAttachmentRecord(noteId, {
      kind,
      name,
      url: stored.url,
      mimeType: stored.mimeType,
      size: stored.size,
      objectKey: stored.key,
    });
    attachmentId = note.attachments.at(-1)?.id;
  } else if (!(await loadWorkspace()).notes.some((candidate) => candidate.id === noteId)) {
    fail("Note not found");
  }
  if (appendMarkdown) {
    const current = note ?? await getNoteRecord(noteId);
    note = await updateNoteRecord(noteId, { content: `${current.content}${markdown.startsWith("\n") ? "" : "\n"}${markdown}\n` }, context);
  }
  return {
    url: stored.url,
    markdown,
    kind,
    mimeType: stored.mimeType,
    size: stored.size,
    objectKey: stored.key,
    ...(attachmentId ? { attachmentId } : {}),
    ...(note ? { note } : {}),
  };
}

/** @deprecated Prefer uploadNoteFile; kept for MCP tool compatibility. */
export async function uploadImageToNote(input: {
  noteId: string;
  source: "url" | "base64";
  data: string;
  filename?: string;
  mimeType?: string;
}, context?: McpOperationContext): Promise<{ url: string; markdown: string }> {
  if (input.source === "base64") {
    const match = /^data:image\//i.exec(input.data.trim());
    if (!match) fail("Invalid base64 image data. Expected format: data:image/[type];base64,[data]");
  } else if (input.mimeType && !isImageMimeType(normalizeUploadMimeType(input.mimeType))) {
    fail("upload_image only accepts image MIME types");
  }
  const result = await uploadNoteFile({
    ...input,
    mimeType: input.mimeType ?? (input.source === "url" ? "image/png" : undefined),
    addAttachment: true,
    appendMarkdown: false,
  }, context);
  return { url: result.url, markdown: result.markdown };
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
    const parent = parentId === null ? undefined : current.folders.find((folder) => folder.id === parentId);
    if (parentId !== null && !parent) fail("Parent folder not found");
    const groupId = input.groupId === undefined
      ? parent?.groupId ?? null
      : optionalId(input.groupId, "Group ID") ?? null;
    validateGroupReference(current, groupId);
    if (parent && parent.groupId !== groupId) fail("A nested folder must belong to the same group as its parent");
    created = { id: createId("folder"), name, parentId, groupId, color: normalizeColor(input.color, "slate"), position: current.folders.length };
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
    const parent = parentId === null ? undefined : current.folders.find((folder) => folder.id === parentId);
    if (parentId !== null && !parent) fail("Parent folder not found");
    validateParent(id, parentId, current.folders);
    const groupId = input.groupId === undefined ? existing.groupId : optionalId(input.groupId, "Group ID") ?? null;
    validateGroupReference(current, groupId);
    if (parent && parent.groupId !== groupId) fail("A nested folder must belong to the same group as its parent");
    const position = input.position === undefined ? existing.position : boundedInteger(input.position, "Position", 0, Number.MAX_SAFE_INTEGER);
    updated = {
      ...existing,
      ...(input.name === undefined ? {} : { name: textValue(input.name, "Folder name", MAX_FOLDER_NAME_LENGTH).trim() }),
      parentId,
      groupId,
      ...(input.color === undefined ? {} : { color: normalizeColor(input.color, existing.color) }),
      position,
    };
    const descendants = new Set<string>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const folder of current.folders) {
        if (folder.parentId && (folder.parentId === id || descendants.has(folder.parentId)) && !descendants.has(folder.id)) {
          descendants.add(folder.id);
          changed = true;
        }
      }
    }
    const affectedFolderIds = new Set([id, ...descendants]);
    const nextFolders = current.folders.map((folder) => folder.id === id
      ? updated as Folder
      : descendants.has(folder.id) && folder.groupId !== groupId
        ? { ...folder, groupId }
        : folder);
    return {
      ...current,
      folders: nextFolders,
      notes: current.notes.map((note) => note.folderId !== null && affectedFolderIds.has(note.folderId) && note.groupId !== groupId
        ? { ...note, groupId, updatedAt: new Date().toISOString() }
        : note),
    };
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

export async function deleteGroupRecord(groupId: string): Promise<{ id: string; deleted: true; detachedNoteCount: number; detachedFolderCount: number }> {
  const id = textValue(groupId, "Group ID", 200);
  let detachedNoteCount = 0;
  let detachedFolderCount = 0;
  await updateWorkspace((workspace) => {
    if (!workspace.groups.some((group) => group.id === id)) fail("Group not found");
    detachedNoteCount = workspace.notes.filter((note) => note.groupId === id).length;
    detachedFolderCount = workspace.folders.filter((folder) => folder.groupId === id).length;
    return {
      ...workspace,
      groups: workspace.groups.filter((group) => group.id !== id),
      folders: workspace.folders.map((folder) => folder.groupId === id ? { ...folder, groupId: null } : folder),
      notes: workspace.notes.map((note) => note.groupId === id ? { ...note, groupId: null, updatedAt: new Date().toISOString() } : note),
    };
  });
  return { id, deleted: true, detachedNoteCount, detachedFolderCount };
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
