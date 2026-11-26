import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

  it("repairs permissions on the persisted MCP token store", async () => {
    const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "notes-mcp-auth-"));
    const token = "cnd_mcp_private_file_test_token_123456";
    process.env.DATA_DIR = dataDirectory;
    delete process.env.MCP_ACCESS_TOKEN;
    const tokenFile = path.join(dataDirectory, "mcp-tokens.json");
    await writeFile(tokenFile, JSON.stringify({ version: 1, tokens: [{
      id: "test-token",
      label: "Test token",
      tokenHash: createHash("sha256").update(token).digest("hex"),
      tokenPrefix: token.slice(0, 12),
      scopes: ["notes:read"],
      createdAt: new Date().toISOString(),
    }] }));
    await chmod(dataDirectory, 0o755);
    await chmod(tokenFile, 0o644);

    const result = await authenticateMcpRequest(new Request("http://localhost/api/mcp", {
      headers: { Authorization: `Bearer ${token}` },
    }));

    expect(result.ok).toBe(true);
    expect((await stat(dataDirectory)).mode & 0o777).toBe(0o700);
    expect((await stat(tokenFile)).mode & 0o777).toBe(0o600);
    expect(await readFile(tokenFile, "utf8")).not.toContain(token);
    await rm(dataDirectory, { recursive: true, force: true });
  });
});
