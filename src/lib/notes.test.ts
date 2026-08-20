import { describe, expect, it } from "vitest";
import { createNote, filterNotes, moveNote, noteMatchesSearch, reorderNotes, toggleChecklist, togglePinned, updateNote } from "@/lib/notes";
import type { Note } from "@/lib/types";

const now = new Date("2026-08-20T12:00:00.000Z");

function note(id: string, title: string, overrides: Partial<Note> = {}): Note {
  return {
    ...createNote(now, title),
    id,
    updatedAt: now.toISOString(),
    ...overrides,
  };
}

describe("note domain", () => {
  it("creates an editable note with stable defaults", () => {
    const created = createNote(now);
    expect(created.title).toBe("Untitled note");
    expect(created.content).toBe("");
    expect(created.folderId).toBeNull();
    expect(created.checklist).toEqual([]);
    expect(created.attachments).toEqual([]);
  });

  it("matches search across content, tags, checklists, and attachments", () => {
    const created = note("one", "Meeting notes", {
      content: "Decide which files to archive",
      tags: ["planning"],
      checklist: [{ id: "item", text: "Ask Sam", completed: false }],
      attachments: [{ id: "link", kind: "link", name: "Linear", url: "https://linear.app" }],
    });
    expect(noteMatchesSearch(created, "archive")).toBe(true);
    expect(noteMatchesSearch(created, "planning")).toBe(true);
    expect(noteMatchesSearch(created, "ask sam")).toBe(true);
    expect(noteMatchesSearch(created, "linear.app")).toBe(true);
    expect(noteMatchesSearch(created, "missing")).toBe(false);
  });

  it("filters archived, pinned, link, and folder views", () => {
    const notes = [
      note("one", "Pinned", { pinned: true, folderId: "folder" }),
      note("two", "Archived", { archived: true }),
      note("three", "Link", { attachments: [{ id: "link", kind: "link", name: "Docs", url: "https://example.com" }] }),
    ];
    expect(filterNotes(notes, { search: "", filter: "pinned", folderId: null, groupId: null }).map((item) => item.id)).toEqual(["one"]);
    expect(filterNotes(notes, { search: "", filter: "archived", folderId: null, groupId: null }).map((item) => item.id)).toEqual(["two"]);
    expect(filterNotes(notes, { search: "", filter: "links", folderId: null, groupId: null }).map((item) => item.id)).toEqual(["three"]);
    expect(filterNotes(notes, { search: "", filter: "all", folderId: "folder", groupId: null }).map((item) => item.id)).toEqual(["one"]);
  });

  it("supports move, reorder, update, pin, and checklist actions", () => {
    const notes = [note("one", "One"), note("two", "Two"), note("three", "Three")];
    const moved = moveNote(notes, "one", "folder", now);
    expect(moved.find((item) => item.id === "one")?.folderId).toBe("folder");
    const reordered = reorderNotes(notes, "three", "one", now);
    expect(reordered.map((item) => item.id)).toEqual(["three", "one", "two"]);
    const updated = updateNote(notes, "two", { content: "Updated" }, now);
    expect(updated.find((item) => item.id === "two")?.content).toBe("Updated");
    const pinned = togglePinned(notes, "two", now);
    expect(pinned.find((item) => item.id === "two")?.pinned).toBe(true);
    const withChecklist = updateNote(notes, "one", { checklist: [{ id: "item", text: "Ship", completed: false }] }, now);
    expect(toggleChecklist(withChecklist, "one", "item", now).find((item) => item.id === "one")?.checklist[0].completed).toBe(true);
  });
});
