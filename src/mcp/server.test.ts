import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
});
