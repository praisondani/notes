import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveWorkspace } from "@/lib/workspace-store";
import { createMcpServer } from "@/mcp/server";

let dataDirectory = "";

beforeEach(async () => {
  dataDirectory = await mkdtemp(path.join(os.tmpdir(), "notes-mcp-server-"));
  process.env.DATA_DIR = dataDirectory;
  await saveWorkspace({ version: 1, notes: [], folders: [], groups: [] });
});

afterEach(async () => {
  delete process.env.DATA_DIR;
  await rm(dataDirectory, { recursive: true, force: true });
});

async function connectServer(readOnly = false) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer({
    tokenId: "test",
    tokenPrefix: "test",
    scopes: new Set(readOnly ? ["notes:read"] : ["notes:read", "notes:write"]),
    source: "file",
  });
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

describe("MCP server", () => {
  it("exposes CRUD, search, RAG, and resources through the MCP protocol", async () => {
    const { client, server } = await connectServer();
    const tools = await client.listTools();
    const created = await client.callTool({
      name: "create_note",
      arguments: { title: "MCP note", content: "A private protocol test", tags: ["protocol"] },
    });
    const createdNote = JSON.parse(String(created.content[0]?.type === "text" ? created.content[0].text : "{}")) as { id: string };
    const search = await client.callTool({ name: "rag_query", arguments: { query: "private protocol" } });
    const resource = await client.readResource({ uri: `notes://notes/${createdNote.id}` });

    expect(tools.tools.map((tool) => tool.name)).toContain("rag_query");
    expect(created.isError).not.toBe(true);
    expect(JSON.stringify(search)).toContain(createdNote.id);
    expect(JSON.stringify(resource)).toContain("A private protocol test");

    await client.close();
    await server.close();
  });

  it("enforces read-only credentials on every write tool", async () => {
    const { client, server } = await connectServer(true);
    const result = await client.callTool({ name: "create_note", arguments: { title: "Should fail" } });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain("notes:write");

    await client.close();
    await server.close();
  });

  it("exposes group hubs and group-owned folders through the protocol", async () => {
    const { client, server } = await connectServer();
    const groupResult = await client.callTool({ name: "create_group", arguments: { name: "Product" } });
    const group = JSON.parse(String(groupResult.content[0]?.type === "text" ? groupResult.content[0].text : "{}")) as { id: string };
    const folderResult = await client.callTool({ name: "create_folder", arguments: { name: "Research", group_id: group.id } });
    const folder = JSON.parse(String(folderResult.content[0]?.type === "text" ? folderResult.content[0].text : "{}")) as { id: string; groupId: string };
    const noteResult = await client.callTool({ name: "create_note", arguments: { title: "Direct", group_id: group.id } });
    const deleteResult = await client.callTool({ name: "delete_group", arguments: { group_id: group.id } });

    expect(groupResult.isError).not.toBe(true);
    expect(folderResult.isError).not.toBe(true);
    expect(folder.groupId).toBe(group.id);
    expect(noteResult.isError).not.toBe(true);
    expect(JSON.stringify(deleteResult)).toContain("detachedFolderCount");

    await client.close();
    await server.close();
  });

  it("returns agent-brain instructions at initialize with the package version", async () => {
    const packageJsonPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../package.json");
    const packageVersion = JSON.parse(await readFile(packageJsonPath, "utf8")).version as string;
    const { client, server } = await connectServer();

    const instructions = client.getInstructions() ?? "";
    const serverInfo = client.getServerVersion();

    expect(instructions).toContain("get_agent_context");
    expect(instructions).toContain("remember");
    expect(instructions.length).toBeGreaterThan(100);
    expect(instructions.length).toBeLessThanOrEqual(1_000);
    expect(serverInfo?.version).toBe(packageVersion);

    await client.close();
    await server.close();
  });

  it("exposes get_agent_context to read-only credentials without write side effects", async () => {
    const writable = await connectServer(false);
    await writable.client.callTool({
      name: "create_note",
      arguments: {
        title: "Agent Brain: start here",
        content: "Index for agents",
        tags: ["agent-brain", "index"],
        pinned: true,
      },
    });
    await writable.client.close();
    await writable.server.close();

    const { client, server } = await connectServer(true);
    const tools = await client.listTools();
    const result = await client.callTool({ name: "get_agent_context", arguments: { max_chars: 2_000 } });
    const payload = JSON.parse(String(result.content[0]?.type === "text" ? result.content[0].text : "{}")) as {
      index?: { title?: string } | null;
      hint?: string;
    };
    const brain = await client.readResource({ uri: "notes://brain" });
    const prompts = await client.listPrompts();

    expect(tools.tools.map((tool) => tool.name)).toContain("get_agent_context");
    expect(result.isError).not.toBe(true);
    expect(payload.index?.title || payload.hint).toBeTruthy();
    expect(JSON.stringify(brain)).toContain("brain_version");
    expect(prompts.prompts.map((prompt) => prompt.name)).toContain("start_session");

    await client.close();
    await server.close();
  });

  it("exposes remember with attribution and rejects read-only credentials", async () => {
    const writable = await connectServer(false);
    const tools = await writable.client.listTools();
    const saved = await writable.client.callTool({
      name: "remember",
      arguments: {
        statement: "George uses Notes as the shared agent brain.",
        kind: "fact",
        source: "session",
      },
    });
    const payload = JSON.parse(String(saved.content[0]?.type === "text" ? saved.content[0].text : "{}")) as {
      status?: string;
      line?: string;
      note_id?: string;
    };

    expect(tools.tools.map((tool) => tool.name)).toContain("remember");
    expect(saved.isError).not.toBe(true);
    expect(payload.status).toBe("saved");
    expect(payload.line).toContain("File Token");
    expect(payload.note_id).toBeTruthy();

    await writable.client.close();
    await writable.server.close();

    const readonly = await connectServer(true);
    const denied = await readonly.client.callTool({
      name: "remember",
      arguments: { statement: "Should not write", kind: "fact" },
    });
    expect(denied.isError).toBe(true);
    expect(JSON.stringify(denied)).toContain("notes:write");

    await readonly.client.close();
    await readonly.server.close();
  });
});
