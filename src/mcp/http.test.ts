import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleMcpRequest } from "@/mcp/http";

const originalEnvironment = { ...process.env };
const token = "cnd_mcp_http_test_012345678901234567890123456789";

beforeEach(() => {
  process.env.MCP_ACCESS_TOKEN = token;
  process.env.MCP_ACCESS_TOKEN_SCOPES = "notes:read,notes:write";
  process.env.APP_URL = "http://localhost:3000";
  process.env.MCP_ALLOWED_HOSTS = "localhost:3000";
  delete process.env.MCP_ALLOWED_ORIGINS;
});

afterEach(() => {
  process.env = { ...originalEnvironment };
});

function mcpRequest(body: unknown, authorization = token): Request {
  return new Request("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authorization}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-06-18",
      Host: "localhost:3000",
    },
    body: JSON.stringify(body),
  });
}

describe("MCP Streamable HTTP boundary", () => {
  it("requires bearer authentication before any MCP response", async () => {
    const response = await handleMcpRequest(new Request("http://localhost:3000/api/mcp", { method: "POST" }));

    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("Notes");
  });

  it("serves stateless initialize and tools/list requests with a valid token", async () => {
    const initialize = await handleMcpRequest(mcpRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "http-test", version: "1.0.0" },
      },
    }));
    const tools = await handleMcpRequest(mcpRequest({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }));
    const initializePayload = await initialize.json() as { result?: { serverInfo?: { name?: string } } };
    const toolsPayload = await tools.json() as { result?: { tools?: Array<{ name: string }> } };

    expect(initialize.status).toBe(200);
    expect(initializePayload.result?.serverInfo?.name).toBe("notes");
    expect(tools.status).toBe(200);
    expect(toolsPayload.result?.tools?.map((tool) => tool.name)).toContain("rag_query");
  });

  it("does not allow browser origins unless explicitly configured", async () => {
    const response = await handleMcpRequest(new Request("http://localhost:3000/api/mcp", {
      method: "OPTIONS",
      headers: { Origin: "https://untrusted.example" },
    }));

    expect(response.status).toBe(403);
  });

  it("fails closed when no host allowlist is configured", async () => {
    delete process.env.MCP_ALLOWED_HOSTS;
    delete process.env.APP_URL;

    const response = await handleMcpRequest(mcpRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "host-check", version: "1.0.0" },
      },
    }));

    expect(response.status).toBe(503);
  });
});
