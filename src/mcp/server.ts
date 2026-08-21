import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";
import { hasMcpScope, type McpAuthContext, type McpScope } from "@/lib/mcp-auth";
import {
  addNoteAttachmentRecord,
  createFolderRecord,
  createGroupRecord,
  createNoteRecord,
  deleteFolderRecord,
  deleteGroupRecord,
  deleteNoteRecord,
  getNoteRecord,
  getWorkspaceSnapshot,
  listFolders,
  listGroups,
  listNotes,
  McpServiceError,
  ragQuery,
  removeNoteAttachmentRecord,
  searchNotes,
  updateFolderRecord,
  updateGroupRecord,
  updateNoteRecord,
  workspaceSummary,
} from "@/lib/mcp-service";

export type McpServerContext = Pick<McpAuthContext, "tokenId" | "tokenPrefix" | "scopes" | "source">;

class McpPermissionError extends Error {
  constructor(scope: McpScope) {
    super(`This MCP credential does not have the ${scope} scope`);
    this.name = "McpPermissionError";
  }
}

const identifier = z.string().min(1).max(200);
const checklistSchema = z.object({
  id: identifier.optional(),
  text: z.string().min(1).max(1_000),
  completed: z.boolean().optional(),
});
const attachmentSchema = z.object({
  id: identifier.optional(),
  kind: z.enum(["image", "file", "link"]),
  name: z.string().min(1).max(200),
  url: z.string().min(1).max(4_096),
  mime_type: z.string().max(150).optional(),
  size: z.number().int().min(0).max(25 * 1024 * 1024).optional(),
  object_key: z.string().max(512).optional(),
});
const noteFieldsSchema = {
  title: z.string().min(1).max(200).optional(),
  content: z.string().max(100_000).optional(),
  folder_id: identifier.nullable().optional(),
  group_id: identifier.nullable().optional(),
  tags: z.array(z.string().min(1).max(64)).max(50).optional(),
  checklist: z.array(checklistSchema).max(100).optional(),
  attachments: z.array(attachmentSchema).max(100).optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
};
const noteInputSchema = z.object(noteFieldsSchema);
const updateNoteInputSchema = noteInputSchema.extend({ note_id: identifier });
const listNotesInputSchema = z.object({
  search: z.string().max(500).optional(),
  filter: z.enum(["all", "inbox", "pinned", "archived", "links", "files"]).optional(),
  folder_id: identifier.nullable().optional(),
  group_id: identifier.nullable().optional(),
  include_archived: z.boolean().optional(),
  include_content: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
});
const searchInputSchema = z.object({
  query: z.string().min(1).max(500),
  include_archived: z.boolean().optional(),
  folder_id: identifier.nullable().optional(),
  group_id: identifier.nullable().optional(),
  limit: z.number().int().min(1).max(50).optional(),
  offset: z.number().int().min(0).optional(),
});
const ragInputSchema = searchInputSchema.extend({
  limit: z.number().int().min(1).max(20).optional(),
  max_context_chars: z.number().int().min(100).max(50_000).optional(),
});
const folderInputSchema = z.object({
  name: z.string().min(1).max(120),
  parent_id: identifier.nullable().optional(),
  color: z.string().min(1).max(32).optional(),
});
const updateFolderInputSchema = folderInputSchema.partial().extend({
  folder_id: identifier,
  position: z.number().int().min(0).optional(),
});
const groupInputSchema = z.object({
  name: z.string().min(1).max(120),
  color: z.string().min(1).max(32).optional(),
});
const updateGroupInputSchema = groupInputSchema.partial().extend({
  group_id: identifier,
  position: z.number().int().min(0).optional(),
});
const deleteFolderInputSchema = z.object({ folder_id: identifier });
const deleteGroupInputSchema = z.object({ group_id: identifier });
const getNoteInputSchema = z.object({ note_id: identifier });
const deleteNoteInputSchema = z.object({ note_id: identifier });
const attachmentInputSchema = z.object({ note_id: identifier, attachment: attachmentSchema });
const removeAttachmentInputSchema = z.object({ note_id: identifier, attachment_id: identifier });

type NoteToolInput = z.infer<typeof noteInputSchema>;
type UpdateNoteToolInput = z.infer<typeof updateNoteInputSchema>;
type ListNotesToolInput = z.infer<typeof listNotesInputSchema>;
type SearchToolInput = z.infer<typeof searchInputSchema>;
type RagToolInput = z.infer<typeof ragInputSchema>;
type FolderInput = z.infer<typeof folderInputSchema>;
type UpdateFolderInput = z.infer<typeof updateFolderInputSchema>;
type GroupInput = z.infer<typeof groupInputSchema>;
type UpdateGroupInput = z.infer<typeof updateGroupInputSchema>;
type AttachmentToolInput = z.infer<typeof attachmentInputSchema>;

function toolResult(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function toolError(error: unknown): CallToolResult {
  const message = error instanceof McpServiceError || error instanceof McpPermissionError
    ? error.message
    : "MCP operation failed";
  return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
}

async function execute<T>(context: McpServerContext, scope: McpScope, operation: () => Promise<T>): Promise<CallToolResult> {
  try {
    if (!hasMcpScope(context, scope)) throw new McpPermissionError(scope);
    return toolResult(await operation());
  } catch (error) {
    return toolError(error);
  }
}

function mapAttachment(input: z.infer<typeof attachmentSchema>) {
  return {
    id: input.id,
    kind: input.kind,
    name: input.name,
    url: input.url,
    mimeType: input.mime_type,
    size: input.size,
    objectKey: input.object_key,
  };
}

function mapNoteInput(input: NoteToolInput) {
  return {
    title: input.title,
    content: input.content,
    folderId: input.folder_id,
    groupId: input.group_id,
    tags: input.tags,
    checklist: input.checklist,
    attachments: input.attachments?.map(mapAttachment),
    pinned: input.pinned,
    archived: input.archived,
  };
}

function mapFolderInput(input: FolderInput) {
  return { name: input.name, parentId: input.parent_id, color: input.color };
}

function mapGroupInput(input: GroupInput) {
  return { name: input.name, color: input.color };
}

export function createMcpServer(context: McpServerContext): McpServer {
  const server = new McpServer({ name: "notes", version: "0.4.0" });

  server.registerTool("workspace_summary", {
    title: "Workspace summary",
    description: "Read counts and freshness metadata for the private Notes workspace.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => execute(context, "notes:read", workspaceSummary));

  server.registerTool("list_notes", {
    title: "List notes",
    description: "List note metadata with optional filters, pagination, and bounded content previews.",
    inputSchema: listNotesInputSchema,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async (input: ListNotesToolInput) => execute(context, "notes:read", () => listNotes({
    search: input.search,
    filter: input.filter,
    folderId: input.folder_id,
    groupId: input.group_id,
    includeArchived: input.include_archived,
    includeContent: input.include_content,
    limit: input.limit,
    offset: input.offset,
  })));

  server.registerTool("get_note", {
    title: "Get note",
    description: "Read one complete note, including checklist items and attachment metadata.",
    inputSchema: getNoteInputSchema,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async (input: { note_id: string }) => execute(context, "notes:read", () => getNoteRecord(input.note_id)));

  server.registerTool("create_note", {
    title: "Create note",
    description: "Create a note. Attachment metadata is supported; binary uploads remain in the web upload flow.",
    inputSchema: noteInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async (input: NoteToolInput) => execute(context, "notes:write", () => createNoteRecord(mapNoteInput(input))));

  server.registerTool("update_note", {
    title: "Update note",
    description: "Update selected fields on an existing note. Omitted fields are preserved.",
    inputSchema: updateNoteInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async (input: UpdateNoteToolInput) => execute(context, "notes:write", () => updateNoteRecord(input.note_id, mapNoteInput(input))));

  server.registerTool("delete_note", {
    title: "Delete note",
    description: "Delete one note. Existing object-storage files are not deleted automatically.",
    inputSchema: deleteNoteInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  }, async (input: { note_id: string }) => execute(context, "notes:write", () => deleteNoteRecord(input.note_id)));

  server.registerTool("add_note_attachment", {
    title: "Add note attachment",
    description: "Add validated link, image, or file metadata to a note without fetching remote content.",
    inputSchema: attachmentInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async (input: AttachmentToolInput) => execute(context, "notes:write", () => addNoteAttachmentRecord(input.note_id, mapAttachment(input.attachment))));

  server.registerTool("remove_note_attachment", {
    title: "Remove note attachment",
    description: "Remove attachment metadata from a note. The referenced object is retained in storage.",
    inputSchema: removeAttachmentInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  }, async (input: { note_id: string; attachment_id: string }) => execute(context, "notes:write", () => removeNoteAttachmentRecord(input.note_id, input.attachment_id)));

  server.registerTool("search_notes", {
    title: "Search notes",
    description: "Run private, local lexical search across titles, content, tags, checklists, and attachment metadata.",
    inputSchema: searchInputSchema,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async (input: SearchToolInput) => execute(context, "notes:read", () => searchNotes(input.query, {
    includeArchived: input.include_archived,
    folderId: input.folder_id,
    groupId: input.group_id,
    limit: input.limit,
    offset: input.offset,
  })));

  server.registerTool("rag_query", {
    title: "Retrieve note context",
    description: "Return ranked, cited note context using a local lexical retriever. No embedding provider or external network call is used.",
    inputSchema: ragInputSchema,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async (input: RagToolInput) => execute(context, "notes:read", () => ragQuery(input.query, {
    includeArchived: input.include_archived,
    folderId: input.folder_id,
    groupId: input.group_id,
    limit: input.limit,
    maxContextChars: input.max_context_chars,
  })));

  server.registerTool("list_folders", {
    title: "List folders",
    description: "Read the folder hierarchy used by the workspace.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => execute(context, "notes:read", listFolders));

  server.registerTool("create_folder", {
    title: "Create folder",
    description: "Create a folder, optionally nested under another folder.",
    inputSchema: folderInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async (input: FolderInput) => execute(context, "notes:write", () => createFolderRecord(mapFolderInput(input))));

  server.registerTool("update_folder", {
    title: "Update folder",
    description: "Rename, recolor, reorder, or move a folder while preventing hierarchy cycles.",
    inputSchema: updateFolderInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async (input: UpdateFolderInput) => execute(context, "notes:write", () => updateFolderRecord(input.folder_id, {
    name: input.name,
    parentId: input.parent_id,
    color: input.color,
    position: input.position,
  })));

  server.registerTool("delete_folder", {
    title: "Delete folder",
    description: "Delete a folder and move its notes to Inbox; child folders become top-level folders.",
    inputSchema: deleteFolderInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  }, async (input: { folder_id: string }) => execute(context, "notes:write", () => deleteFolderRecord(input.folder_id)));

  server.registerTool("list_groups", {
    title: "List groups",
    description: "Read note groups.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => execute(context, "notes:read", listGroups));

  server.registerTool("create_group", {
    title: "Create group",
    description: "Create a note group.",
    inputSchema: groupInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async (input: GroupInput) => execute(context, "notes:write", () => createGroupRecord(mapGroupInput(input))));

  server.registerTool("update_group", {
    title: "Update group",
    description: "Rename, recolor, or reorder a note group.",
    inputSchema: updateGroupInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async (input: UpdateGroupInput) => execute(context, "notes:write", () => updateGroupRecord(input.group_id, {
    name: input.name,
    color: input.color,
    position: input.position,
  })));

  server.registerTool("delete_group", {
    title: "Delete group",
    description: "Delete a group and clear its group reference from notes.",
    inputSchema: deleteGroupInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  }, async (input: { group_id: string }) => execute(context, "notes:write", () => deleteGroupRecord(input.group_id)));

  server.registerResource("workspace", "notes://workspace", {
    title: "Notes workspace",
    description: "The authenticated Notes workspace as JSON.",
    mimeType: "application/json",
  }, async (uri) => {
    if (!hasMcpScope(context, "notes:read")) throw new McpPermissionError("notes:read");
    return { contents: [{ uri: uri.toString(), mimeType: "application/json", text: JSON.stringify(await getWorkspaceSnapshot()) }] };
  });

  server.registerResource("note", new ResourceTemplate("notes://notes/{noteId}", {
    list: async () => {
      if (!hasMcpScope(context, "notes:read")) throw new McpPermissionError("notes:read");
      const workspace = await getWorkspaceSnapshot();
      return {
        resources: workspace.notes.map((note) => ({
          uri: `notes://notes/${encodeURIComponent(note.id)}`,
          name: note.title,
          description: note.archived ? "Archived note" : "Note",
          mimeType: "application/json",
        })),
      };
    },
  }), {
    title: "Notes note",
    description: "One authenticated Notes note as JSON.",
    mimeType: "application/json",
  }, async (uri, variables) => {
    if (!hasMcpScope(context, "notes:read")) throw new McpPermissionError("notes:read");
    const variableId = variables.noteId;
    const rawId = Array.isArray(variableId) ? variableId[0] : variableId ?? uri.pathname.split("/").filter(Boolean).pop();
    if (!rawId) throw new McpServiceError("Note ID is required");
    const note = await getNoteRecord(decodeURIComponent(rawId));
    return { contents: [{ uri: uri.toString(), mimeType: "application/json", text: JSON.stringify(note) }] };
  });

  return server;
}
