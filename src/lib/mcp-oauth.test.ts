import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  approveAuthorizationRequest,
  beginAuthorizationRequest,
  createCodeChallenge,
  exchangeAuthorizationCode,
  exchangeRefreshToken,
  getAuthorizationRequest,
  registerOAuthClient,
  verifyOAuthAccessToken,
} from "@/lib/mcp-oauth";

let dataDirectory = "";
const originalEnvironment = { ...process.env };
const resource = "http://localhost:3000/api/mcp";
const verifier = "codex-test-code-verifier-with-enough-entropy-123456789";

beforeEach(async () => {
  dataDirectory = await mkdtemp(path.join(os.tmpdir(), "notes-mcp-oauth-"));
  process.env.DATA_DIR = dataDirectory;
  process.env.APP_URL = "http://localhost:3000";
});

afterEach(async () => {
  process.env = { ...originalEnvironment };
  await rm(dataDirectory, { recursive: true, force: true });
});

describe("MCP OAuth authorization code flow", () => {
  it("registers a public client, binds consent to PKCE, and issues scoped tokens", async () => {
    const registration = await registerOAuthClient({
      clientName: "Codex",
      redirectUris: ["http://127.0.0.1:54321/callback"],
      tokenEndpointAuthMethod: "none",
      scopes: ["notes:read", "notes:write"],
    });

    expect(registration.client.clientId).toMatch(/^notes_client_/);
    expect(registration.clientSecret).toBeUndefined();

    const pending = await beginAuthorizationRequest({
      clientId: registration.client.clientId,
      redirectUri: "http://127.0.0.1:54321/callback",
      state: "state-123",
      codeChallenge: createCodeChallenge(verifier),
      scopes: ["notes:read"],
      resource,
    }, "browser-secret");

    expect(await getAuthorizationRequest(pending.transactionId, "browser-secret")).toMatchObject({
      clientName: "Codex",
      scopes: ["notes:read"],
    });

    const approved = await approveAuthorizationRequest(pending.transactionId, "browser-secret", "owner");
    expect(approved.state).toBe("state-123");
    expect(approved.code).toMatch(/^notes_code_/);

    const tokens = await exchangeAuthorizationCode({
      clientId: registration.client.clientId,
      code: approved.code,
      codeVerifier: verifier,
      redirectUri: "http://127.0.0.1:54321/callback",
      resource,
    });

    expect(tokens.tokenType).toBe("Bearer");
    expect(tokens.accessToken).toMatch(/^cnd_oauth_/);
    expect(tokens.refreshToken).toMatch(/^cnd_oauth_refresh_/);

    const accessContext = await verifyOAuthAccessToken(tokens.accessToken, resource);
    expect(accessContext).toMatchObject({ userId: "owner", scopes: ["notes:read"], source: "oauth" });
  });

  it("rotates refresh tokens and rejects the previous refresh token", async () => {
    const registration = await registerOAuthClient({
      clientName: "Cursor",
      redirectUris: ["https://cursor.example/callback"],
      tokenEndpointAuthMethod: "none",
      scopes: ["notes:read"],
    });
    const pending = await beginAuthorizationRequest({
      clientId: registration.client.clientId,
      redirectUri: "https://cursor.example/callback",
      codeChallenge: createCodeChallenge(verifier),
      scopes: ["notes:read"],
      resource,
    }, "browser-secret");
    const approved = await approveAuthorizationRequest(pending.transactionId, "browser-secret", "owner");
    const initial = await exchangeAuthorizationCode({
      clientId: registration.client.clientId,
      code: approved.code,
      codeVerifier: verifier,
      redirectUri: "https://cursor.example/callback",
      resource,
    });

    const rotated = await exchangeRefreshToken({
      clientId: registration.client.clientId,
      refreshToken: initial.refreshToken,
      resource,
    });
    expect(rotated.refreshToken).not.toBe(initial.refreshToken);
    await expect(exchangeRefreshToken({
      clientId: registration.client.clientId,
      refreshToken: initial.refreshToken,
      resource,
    })).rejects.toThrow("Invalid refresh token");
  });
});
