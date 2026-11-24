import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendToNote,
  createNoteRecord,
  getNoteRecord,
  updateNoteRecord,
} from "@/lib/mcp-service";
import { saveWorkspace } from "@/lib/workspace-store";

let dataDirectory = "";

beforeEach(async () => {
  dataDirectory = await mkdtemp(path.join(os.tmpdir(), "notes-concurrent-"));
  process.env.DATA_DIR = dataDirectory;
  await saveWorkspace({ version: 1, notes: [], folders: [], groups: [] });
});

afterEach(async () => {
  delete process.env.DATA_DIR;
  await rm(dataDirectory, { recursive: true, force: true });
});

describe("append_to_note", () => {
  it("appends markdown atomically under a heading", async () => {
    const note = await createNoteRecord({
      title: "Shared",
      content: "## Status\n- old\n\n## Other\n- keep\n",
    });

    const [first, second] = await Promise.all([
      appendToNote({ noteId: note.id, markdown: "- first parallel", underHeading: "Status" }),
      appendToNote({ noteId: note.id, markdown: "- second parallel", underHeading: "Status" }),
    ]);

    expect(first.id).toBe(note.id);
    expect(second.id).toBe(note.id);
    const latest = await getNoteRecord(note.id);
    expect(latest.content).toContain("- first parallel");
    expect(latest.content).toContain("- second parallel");
    expect(latest.content).toContain("## Other\n- keep");
    const statusBlock = latest.content.split("## Other")[0] ?? "";
    expect(statusBlock).toContain("## Status");
    expect(statusBlock).toContain("- first parallel");
    expect(statusBlock).toContain("- second parallel");
  });

  it("supports top_of_section position", async () => {
    const note = await createNoteRecord({
      title: "Pinned section",
      content: "## Inbox\n- older\n",
    });
    const updated = await appendToNote({
      noteId: note.id,
      markdown: "- newest",
      underHeading: "Inbox",
      position: "top_of_section",
    });
    const lines = updated.content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const inboxIndex = lines.indexOf("## Inbox");
    expect(lines[inboxIndex + 1]).toBe("- newest");
    expect(lines[inboxIndex + 2]).toBe("- older");
  });
});

describe("update_note expected_updated_at", () => {
  it("rejects stale expected_updated_at with a conflict error", async () => {
    const note = await createNoteRecord({ title: "Conflict", content: "v1" });
    const current = await updateNoteRecord(note.id, { content: "v2" });
    expect(current.content).toBe("v2");
    await expect(updateNoteRecord(note.id, {
      content: "stale write",
      expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
    })).rejects.toThrow(/conflict/i);

    const latest = await getNoteRecord(note.id);
    expect(latest.content).toBe("v2");
  });

  it("allows update when expected_updated_at matches", async () => {
    const note = await createNoteRecord({ title: "Fresh", content: "v1" });
    const fresh = await getNoteRecord(note.id);
    const updated = await updateNoteRecord(note.id, {
      content: "v2",
      expectedUpdatedAt: fresh.updatedAt,
    });
    expect(updated.content).toBe("v2");
  });
});

describe("secrets guard warning on note writes", () => {
  it("warns but still writes on create, update, and append", async () => {
    const created = await createNoteRecord({
      title: "Secrety",
      content: "key sk-test-abcdefghijklmnopqrstuvwxyz012345",
    });
    expect(created.content).toContain("sk-test-");
    expect((created as { warning?: string }).warning).toMatch(/secret/i);

    const updated = await updateNoteRecord(created.id, {
      content: "password: hunter2-secret",
    });
    expect(updated.content).toContain("password:");
    expect((updated as { warning?: string }).warning).toMatch(/secret/i);

    const appended = await appendToNote({
      noteId: created.id,
      markdown: "otp verification code 482193",
    });
    expect(appended.content).toContain("482193");
    expect((appended as { warning?: string }).warning).toMatch(/secret/i);
  });
});
