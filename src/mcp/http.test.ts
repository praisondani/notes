import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { handleMcpRequest } from "@/mcp/http";
import { approveAuthorizationRequest, beginAuthorizationRequest, createCodeChallenge, exchangeAuthorizationCode, registerOAuthClient } from "@/lib/mcp-oauth";

const originalEnvironment = { ...process.env };
const token = "cnd_mcp_http_test_012345678901234567890123456789";
let dataDirectory = "";

beforeEach(async () => {
  dataDirectory = await mkdtemp(path.join(os.tmpdir(), "notes-mcp-http-"));
  process.env.DATA_DIR = dataDirectory;
  process.env.MCP_ACCESS_TOKEN = token;
  process.env.MCP_ACCESS_TOKEN_SCOPES = "notes:read,notes:write";
  process.env.APP_URL = "http://localhost:3000";
  process.env.MCP_ALLOWED_HOSTS = "localhost:3000";
  delete process.env.MCP_ALLOWED_ORIGINS;
});

afterEach(async () => {
  process.env = { ...originalEnvironment };
  await rm(dataDirectory, { recursive: true, force: true });
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
    expect(response.headers.get("WWW-Authenticate")).toContain("resource_metadata=\"http://localhost:3000/.well-known/oauth-protected-resource\"");
    expect(await response.text()).not.toContain("Notes");
  });

  it("accepts a browser-authorized OAuth access token", async () => {
    delete process.env.MCP_ACCESS_TOKEN;
    const registration = await registerOAuthClient({ clientName: "OAuth test", redirectUris: ["http://127.0.0.1:43210/callback"] });
    const verifier = "oauth-http-test-code-verifier-with-enough-entropy-123456789";
    const pending = await beginAuthorizationRequest({
      clientId: registration.client.clientId,
      redirectUri: "http://127.0.0.1:43210/callback",
      codeChallenge: createCodeChallenge(verifier),
      resource: "http://localhost:3000/api/mcp",
    }, "browser-secret");
    const approved = await approveAuthorizationRequest(pending.transactionId, "browser-secret", "owner");
    const tokens = await exchangeAuthorizationCode({
      clientId: registration.client.clientId,
      code: approved.code ?? "",
      codeVerifier: verifier,
      redirectUri: "http://127.0.0.1:43210/callback",
      resource: "http://localhost:3000/api/mcp",
    });
    const response = await handleMcpRequest(mcpRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "oauth-http-test", version: "1.0.0" },
      },
    }, tokens.accessToken));

    expect(response.status).toBe(200);
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
