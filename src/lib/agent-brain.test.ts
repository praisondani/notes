import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNoteRecord, getAgentContext, updateNoteRecord } from "@/lib/mcp-service";
import { loadWorkspaceSnapshot, saveWorkspace } from "@/lib/workspace-store";

let dataDirectory = "";

beforeEach(async () => {
  dataDirectory = await mkdtemp(path.join(os.tmpdir(), "notes-agent-brain-"));
  process.env.DATA_DIR = dataDirectory;
  const initial = await loadWorkspaceSnapshot();
  await saveWorkspace({ version: 1, notes: [], folders: [], groups: [] }, initial.revision);
});

afterEach(async () => {
  delete process.env.DATA_DIR;
  await rm(dataDirectory, { recursive: true, force: true });
});

describe("get_agent_context", () => {
  it("returns a short hint when no agent brain notes exist", async () => {
    const context = await getAgentContext();
    expect(context.hint).toMatch(/agent brain/i);
    expect(context.index).toBeNull();
    expect(context.notes).toEqual([]);
    expect(context.truncated).toBe(false);
  });

  it("puts the index note first and respects max_chars", async () => {
    const index = await createNoteRecord({
      title: "Agent Brain: start here",
      content: "Index body ".repeat(200),
      tags: ["agent-brain", "index"],
      pinned: true,
    });
    const profile = await createNoteRecord({
      title: "Agent Brain: profile",
      content: "Profile facts ".repeat(200),
      tags: ["agent-brain", "profile"],
    });
    await createNoteRecord({
      title: "Agent Brain: bridge",
      content: "Bridge line one\nBridge line two\nBridge line three",
      tags: ["agent-bridge"],
    });

    const context = await getAgentContext({ maxChars: 400 });
    expect(context.index?.id).toBe(index.id);
    expect(context.notes[0]?.id).toBe(index.id);
    expect(context.truncated).toBe(true);
    expect(
      context.notes.some((note) => note.id === profile.id)
      || context.remaining_note_ids.includes(profile.id),
    ).toBe(true);
    expect(context.remaining_note_ids.length).toBeGreaterThan(0);
    expect(context.content.length).toBeLessThanOrEqual(400);
    expect(context.brain_version).toBeTruthy();
    expect(context.updated_at).toBeTruthy();
  });

  it("falls back to the start-here title when the index tag is missing", async () => {
    const index = await createNoteRecord({
      title: "Agent Brain: start here",
      content: "Welcome",
      tags: ["agent-brain"],
      pinned: true,
    });
    const context = await getAgentContext();
    expect(context.index?.id).toBe(index.id);
  });

  it("includes topic hits from rag_query without writing", async () => {
    await createNoteRecord({
      title: "Agent Brain: start here",
      content: "Index",
      tags: ["agent-brain", "index"],
      pinned: true,
    });
    const project = await createNoteRecord({
      title: "FieldRobin status",
      content: "FieldRobin uses Notes as the shared brain for routing.",
      tags: ["agent-brain", "projects"],
    });
    const before = await getAgentContext({ topic: "FieldRobin routing" });
    const afterUpdate = await updateNoteRecord(project.id, { content: "FieldRobin uses Notes as the shared brain for routing. unchanged" });
    const after = await getAgentContext({ topic: "FieldRobin routing" });

    expect(before.topic_hits.some((hit) => hit.noteId === project.id)).toBe(true);
    expect(after.updated_at).toBe(afterUpdate.updatedAt);
  });
});
