import { afterEach, describe, expect, it } from "vitest";
import { authenticateMcpRequest } from "@/lib/mcp-auth";

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe("MCP bearer authentication", () => {
  it("rejects an unconfigured endpoint instead of serving notes anonymously", async () => {
    delete process.env.MCP_ACCESS_TOKEN;
    delete process.env.DATA_DIR;

    const result = await authenticateMcpRequest(new Request("http://localhost/api/mcp"));

    expect(result).toEqual({ status: 401, ok: false, message: "Authentication required" });
  });

  it("accepts a long environment token and returns configured scopes", async () => {
    process.env.MCP_ACCESS_TOKEN = "cnd_mcp_012345678901234567890123456789";
    process.env.MCP_ACCESS_TOKEN_SCOPES = "notes:read,notes:write";

    const result = await authenticateMcpRequest(new Request("http://localhost/api/mcp", {
      headers: { Authorization: `Bearer ${process.env.MCP_ACCESS_TOKEN}` },
    }));

    expect(result.ok).toBe(true);
    if (result.ok) expect([...result.context.scopes]).toEqual(["notes:read", "notes:write"]);
  });

  it("does not accept an invalid token or a short configured token", async () => {
    process.env.MCP_ACCESS_TOKEN = "too-short";

    const result = await authenticateMcpRequest(new Request("http://localhost/api/mcp", {
      headers: { Authorization: "Bearer cnd_mcp_invalid" },
    }));

    expect(result).toEqual({ status: 401, ok: false, message: "Invalid MCP credentials" });
  });
});
