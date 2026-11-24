import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNoteRecord, getNoteRecord } from "@/lib/mcp-service";
import { saveWorkspace, updateWorkspace } from "@/lib/workspace-store";
import type { Note } from "@/lib/types";

let dataDirectory = "";

beforeEach(async () => {
  dataDirectory = await mkdtemp(path.join(os.tmpdir(), "notes-id-prefix-"));
  process.env.DATA_DIR = dataDirectory;
  await saveWorkspace({ version: 1, notes: [], folders: [], groups: [] });
});

afterEach(async () => {
  delete process.env.DATA_DIR;
  await rm(dataDirectory, { recursive: true, force: true });
});

describe("get_note id prefix", () => {
  it("resolves a unique 8+ hex prefix after note-", async () => {
    const note = await createNoteRecord({ title: "Prefixed", content: "hello" });
    const hex = note.id.slice("note-".length).replace(/-/g, "").slice(0, 8);
    const found = await getNoteRecord(`note-${hex}`);
    expect(found.id).toBe(note.id);
    expect(found.content).toBe("hello");
  });

  it("returns ambiguous when multiple notes share the prefix", async () => {
    await updateWorkspace((workspace) => {
      const shared = "aabbccdd";
      const first: Note = {
        id: `note-${shared}-1111-4111-8111-111111111111`,
        title: "One",
        content: "a",
        folderId: null,
        groupId: null,
        tags: [],
        checklist: [],
        attachments: [],
        pinned: false,
        archived: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        position: 0,
      };
      const second: Note = {
        ...first,
        id: `note-${shared}-2222-4222-8222-222222222222`,
        title: "Two",
        content: "b",
        position: 1,
      };
      return { ...workspace, notes: [first, second] };
    });

    await expect(getNoteRecord("note-aabbccdd")).rejects.toThrow(/ambiguous/i);
  });

  it("still requires the full id when the prefix is shorter than 8 hex chars", async () => {
    const note = await createNoteRecord({ title: "Short", content: "x" });
    const short = note.id.slice(0, "note-".length + 4);
    await expect(getNoteRecord(short)).rejects.toThrow(/not found/i);
  });
});
