import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getNoteRecord, listNotes, rememberNote } from "@/lib/mcp-service";
import { saveWorkspace } from "@/lib/workspace-store";

let dataDirectory = "";

beforeEach(async () => {
  dataDirectory = await mkdtemp(path.join(os.tmpdir(), "notes-remember-"));
  process.env.DATA_DIR = dataDirectory;
  process.env.NOTES_TIME_ZONE = "America/Chicago";
  await saveWorkspace({ version: 1, notes: [], folders: [], groups: [] });
});

afterEach(async () => {
  delete process.env.DATA_DIR;
  delete process.env.NOTES_TIME_ZONE;
  await rm(dataDirectory, { recursive: true, force: true });
});

const client = { source: "oauth" as const, clientId: "notes_client_abc", clientName: "Grok Bot" };

describe("remember", () => {
  it("saves parallel remembers atomically with client attribution", async () => {
    const [first, second] = await Promise.all([
      rememberNote({ statement: "George runs Notes at notes.cdir.io.", kind: "fact", source: "chat" }, client),
      rememberNote({ statement: "Prefer short status updates in Slack.", kind: "preference", source: "chat" }, client),
    ]);

    expect(first.status).toBe("saved");
    expect(second.status).toBe("saved");
    if (first.status !== "saved" || second.status !== "saved") return;
    const note = await getNoteRecord(first.note_id);
    expect(note.content).toContain("Grok Bot");
    expect(note.content).toContain("George runs Notes at notes.cdir.io.");
    expect(note.tags).toContain("agent-brain");
  });

  it("skips exact duplicates", async () => {
    const first = await rememberNote({ statement: "Timezone is America/Chicago.", kind: "fact" }, client);
    const second = await rememberNote({ statement: "Timezone is America/Chicago.", kind: "fact" }, client);
    expect(first.status).toBe("saved");
    expect(second.status).toBe("duplicate");
    if (second.status === "duplicate") {
      expect(second.note_id).toBeTruthy();
      expect(second.existing).toContain("America/Chicago");
    }
  });

  it("marks older lines superseded on correction", async () => {
    const original = await rememberNote({ statement: "Launch date is Friday.", kind: "fact" }, client);
    expect(original.status).toBe("saved");
    const correction = await rememberNote({
      statement: "Launch date moved to Monday.",
      kind: "correction",
      reason: "schedule slip",
    }, client);
    expect(correction.status).toBe("saved");
    if (original.status !== "saved") return;
    const note = await getNoteRecord(original.note_id);
    expect(note.content).toMatch(/Launch date is Friday\..*\(superseded \d{4}-\d{2}-\d{2}\)/);
    expect(note.content).toContain("Launch date moved to Monday.");
  });

  it.each([
    "API key sk-test-abcdefghijklmnopqrstuvwxyz012345",
    "token ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    "slack xoxb-123456789012-123456789012-abcdefghijklmnopqrstuvwx",
    "aws AKIAIOSFODNN7EXAMPLE",
    "google AIzaSyA-abcdefghijklmnopqrstuvwxyz0123",
    "-----BEGIN PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF4P\n-----END PRIVATE KEY-----",
    "jwt eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature",
    "password: hunter2-secret",
    "verification code 482193",
    "card 4111111111111111",
  ])("rejects secret pattern without writing: %s", async (statement) => {
    await expect(rememberNote({ statement, kind: "fact" }, client)).rejects.toThrow(/Looks like a secret/);
    const listed = await listNotes({ includeContent: true, limit: 50 });
    expect(listed.notes).toHaveLength(0);
  });

  it("routes decisions and project status to dedicated notes", async () => {
    const decision = await rememberNote({
      statement: "Use manual Deploy workflow for Notes releases.",
      kind: "decision",
      reason: "keep George in control",
      source: "ops",
    }, client);
    const project = await rememberNote({
      statement: "FieldRobin MCP write scopes are live.",
      kind: "project_status",
      topic: "FieldRobin",
      source: "ship",
    }, client);

    expect(decision.status).toBe("saved");
    expect(project.status).toBe("saved");
    if (decision.status !== "saved" || project.status !== "saved") return;
    const decisions = await getNoteRecord(decision.note_id);
    const projects = await getNoteRecord(project.note_id);
    expect(decisions.title.toLocaleLowerCase()).toContain("decision");
    expect(projects.content).toContain("FieldRobin");
  });
});
