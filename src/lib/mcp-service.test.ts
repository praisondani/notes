import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveWorkspace } from "@/lib/workspace-store";
import {
  createFolderRecord,
  createGroupRecord,
  createNoteRecord,
  deleteFolderRecord,
  deleteGroupRecord,
  deleteNoteRecord,
  getNoteRecord,
  getWorkspaceSnapshot,
  listNotes,
  ragQuery,
  searchNotes,
  updateNoteRecord,
} from "@/lib/mcp-service";

let dataDirectory = "";

beforeEach(async () => {
  dataDirectory = await mkdtemp(path.join(os.tmpdir(), "notes-mcp-"));
  process.env.DATA_DIR = dataDirectory;
  await saveWorkspace({ version: 1, notes: [], folders: [], groups: [] });
});

afterEach(async () => {
  delete process.env.DATA_DIR;
  await rm(dataDirectory, { recursive: true, force: true });
});

describe("MCP note service", () => {
  it("supports concurrent note creation without losing writes", async () => {
    const created = await Promise.all([
      createNoteRecord({ title: "Alpha", content: "First" }),
      createNoteRecord({ title: "Beta", content: "Second" }),
      createNoteRecord({ title: "Gamma", content: "Third" }),
    ]);

    const result = await listNotes({ includeArchived: true, limit: 20, offset: 0 });

    expect(created).toHaveLength(3);
    expect(result.total).toBe(3);
    expect(result.notes.map((note) => note.title).sort()).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("validates references and updates note fields through the public service", async () => {
    const group = await createGroupRecord({ name: "Work" });
    const folder = await createFolderRecord({ name: "Research", groupId: group.id });
    const note = await createNoteRecord({
      title: "Research plan",
      content: "Collect the evidence before making a decision.",
      folderId: folder.id,
      groupId: group.id,
      tags: ["research", "work"],
    });

    await expect(createNoteRecord({ title: "Bad reference", folderId: "folder-missing" })).rejects.toThrow("Folder not found");

    const updated = await updateNoteRecord(note.id, {
      content: "Collect primary evidence before making a decision.",
      pinned: true,
    });

    expect(updated.content).toContain("primary evidence");
    expect(updated.pinned).toBe(true);
    expect((await getNoteRecord(note.id)).id).toBe(note.id);

    await deleteFolderRecord(folder.id);
    await deleteGroupRecord(group.id);
    const detached = await getNoteRecord(note.id);
    expect(detached.folderId).toBeNull();
    expect(detached.groupId).toBeNull();
  });

  it("ranks lexical search and returns grounded RAG sources with a context cap", async () => {
    const matching = await createNoteRecord({
      title: "Cloud storage migration",
      content: "Move the private attachments to an S3 compatible bucket after the backup.",
      tags: ["storage", "migration"],
    });
    await createNoteRecord({ title: "Unrelated note", content: "A quiet list of books to read." });

    const search = await searchNotes("private attachments", { limit: 5 });
    const rag = await ragQuery("private attachments", { limit: 5, maxContextChars: 300 });

    expect(search.results[0]?.noteId).toBe(matching.id);
    expect(search.results[0]?.matchedFields).toContain("content");
    expect(rag.results[0]?.uri).toBe(`notes://notes/${matching.id}`);
    expect(rag.context.length).toBeLessThanOrEqual(300);
    expect(rag.context).toContain(matching.title);
  });

  it("deletes notes without exposing or mutating unrelated records", async () => {
    const keep = await createNoteRecord({ title: "Keep" });
    const remove = await createNoteRecord({ title: "Remove" });

    const deleted = await deleteNoteRecord(remove.id);
    const notes = await listNotes({ includeArchived: true, limit: 10, offset: 0 });

    expect(deleted.id).toBe(remove.id);
    expect(notes.notes.map((note) => note.id)).toEqual([keep.id]);
  });

  it("models groups as hubs that can own folders and direct notes", async () => {
    const work = await createGroupRecord({ name: "Work" });
    const personal = await createGroupRecord({ name: "Personal" });
    const projects = await createFolderRecord({ name: "Projects", groupId: work.id });

    await expect(createFolderRecord({ name: "Wrong parent", parentId: projects.id, groupId: personal.id })).rejects.toThrow("same group");
    const directNote = await createNoteRecord({ title: "Direct note", groupId: work.id });
    const folderNote = await createNoteRecord({ title: "Folder note", folderId: projects.id, groupId: work.id });

    const deleted = await deleteGroupRecord(work.id);
    const snapshot = await getWorkspaceSnapshot();
    expect(deleted.detachedFolderCount).toBe(1);
    expect(snapshot.folders.find((folder) => folder.id === projects.id)?.groupId).toBeNull();
    expect(snapshot.notes.find((note) => note.id === directNote.id)?.groupId).toBeNull();
    expect(snapshot.notes.find((note) => note.id === folderNote.id)?.folderId).toBe(projects.id);
    expect(snapshot.notes.find((note) => note.id === folderNote.id)?.groupId).toBeNull();
  });
});
