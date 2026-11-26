import { chmod, mkdtemp, rm, stat } from "node:fs/promises";
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
  listOAuthClients,
  oauthClientAttributionName,
  oauthClientDisplayName,
  registerOAuthClient,
  revokeOAuthClient,
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
  delete process.env.MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS;
  delete process.env.MCP_OAUTH_REFRESH_TOKEN_TTL_DAYS;
});

afterEach(async () => {
  process.env = { ...originalEnvironment };
  await rm(dataDirectory, { recursive: true, force: true });
});

async function issueTokens(scopes?: ("notes:read" | "notes:write")[]) {
  const registration = await registerOAuthClient({
    clientName: "Grok Bot",
    redirectUris: ["https://grok.example/callback"],
    tokenEndpointAuthMethod: "none",
  });
  const pending = await beginAuthorizationRequest({
    clientId: registration.client.clientId,
    redirectUri: "https://grok.example/callback",
    codeChallenge: createCodeChallenge(verifier),
    ...(scopes ? { scopes } : {}),
    resource,
  }, "browser-secret");
  const approved = await approveAuthorizationRequest(pending.transactionId, "browser-secret", "owner");
  const tokens = await exchangeAuthorizationCode({
    clientId: registration.client.clientId,
    code: approved.code!,
    codeVerifier: verifier,
    redirectUri: "https://grok.example/callback",
    resource,
  });
  return { registration, tokens };
}

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
      code: approved.code!,
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

  it("defaults omitted authorize scopes to read and write", async () => {
    const { tokens } = await issueTokens();
    expect(tokens.scope).toEqual(["notes:read", "notes:write"]);
    const accessContext = await verifyOAuthAccessToken(tokens.accessToken, resource);
    expect(accessContext?.scopes).toEqual(["notes:read", "notes:write"]);
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
      code: approved.code!,
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

  it("keeps originally granted read+write scopes when refresh omits scope", async () => {
    const { registration, tokens } = await issueTokens(["notes:read", "notes:write"]);
    expect(tokens.scope).toEqual(["notes:read", "notes:write"]);

    const refreshed = await exchangeRefreshToken({
      clientId: registration.client.clientId,
      refreshToken: tokens.refreshToken,
      resource,
      // intentionally omit scopes — matches real MCP clients
    });

    expect(refreshed.scope).toEqual(["notes:read", "notes:write"]);
    const accessContext = await verifyOAuthAccessToken(refreshed.accessToken, resource);
    expect(accessContext?.scopes).toEqual(["notes:read", "notes:write"]);
  });

  it("heals refresh tokens that previously lost write after a buggy refresh", async () => {
    const { registration, tokens } = await issueTokens(["notes:read", "notes:write"]);

    // Simulate the pre-0.6.4 bug: a refresh token that only retained notes:read
    // while history still shows the client was granted write.
    const storePath = path.join(dataDirectory, "mcp-oauth.json");
    const { readFile, writeFile } = await import("node:fs/promises");
    const store = JSON.parse(await readFile(storePath, "utf8")) as {
      refreshTokens: Array<{ tokenHash: string; scopes: string[]; revokedAt?: string | null }>;
      accessTokens: Array<{ scopes: string[] }>;
      migrations?: { refreshScopesHealedAt?: string };
    };
    const activeRefresh = store.refreshTokens.find((token) => !token.revokedAt);
    expect(activeRefresh).toBeTruthy();
    activeRefresh!.scopes = ["notes:read"];
    delete store.migrations;
    await writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");

    const healed = await exchangeRefreshToken({
      clientId: registration.client.clientId,
      refreshToken: tokens.refreshToken,
      resource,
    });

    expect(healed.scope).toEqual(["notes:read", "notes:write"]);
    const accessContext = await verifyOAuthAccessToken(healed.accessToken, resource);
    expect(accessContext?.scopes).toEqual(["notes:read", "notes:write"]);
  });

  it("allows refresh to narrow scopes but never expand beyond the grant", async () => {
    const { registration, tokens } = await issueTokens(["notes:read", "notes:write"]);
    const narrowed = await exchangeRefreshToken({
      clientId: registration.client.clientId,
      refreshToken: tokens.refreshToken,
      scopes: ["notes:read"],
      resource,
    });
    expect(narrowed.scope).toEqual(["notes:read"]);

    await expect(exchangeRefreshToken({
      clientId: registration.client.clientId,
      refreshToken: narrowed.refreshToken,
      scopes: ["notes:read", "notes:write"],
      resource,
    })).rejects.toThrow(/scope/i);
  });

  it("uses configurable TTLs and surfaces scopes/expiry in the client list", async () => {
    process.env.MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS = "120";
    process.env.MCP_OAUTH_REFRESH_TOKEN_TTL_DAYS = "180";
    const { tokens } = await issueTokens(["notes:read", "notes:write"]);
    expect(tokens.expiresIn).toBe(120);

    const clients = await listOAuthClients();
    expect(clients[0]).toMatchObject({
      clientName: "Grok Bot",
      grantedScopes: ["notes:read", "notes:write"],
      activeTokenCount: 1,
    });
    expect(clients[0]?.accessTokenExpiresAt).toBeTruthy();
    expect(clients[0]?.refreshTokenExpiresAt).toBeTruthy();
    const refreshExpiry = new Date(clients[0]!.refreshTokenExpiresAt!).getTime();
    const expectedMin = Date.now() + 170 * 24 * 60 * 60 * 1_000;
    expect(refreshExpiry).toBeGreaterThan(expectedMin);
  });

  it("stores a friendlier consent label and uses it for attribution", async () => {
    const registration = await registerOAuthClient({
      clientName: "Cursor",
      redirectUris: ["http://127.0.0.1:9/callback"],
      scopes: ["notes:read", "notes:write"],
    });
    const pending = await beginAuthorizationRequest({
      clientId: registration.client.clientId,
      redirectUri: "http://127.0.0.1:9/callback",
      codeChallenge: createCodeChallenge(verifier),
      scopes: ["notes:read"],
      resource,
    }, "browser-secret");
    await approveAuthorizationRequest(pending.transactionId, "browser-secret", "owner", true, {
      clientLabel: "Cursor on Studio Mac",
    });

    const clients = await listOAuthClients();
    const client = clients.find((entry) => entry.clientId === registration.client.clientId);
    expect(client?.clientLabel).toBe("Cursor on Studio Mac");
    expect(oauthClientAttributionName(client!)).toBe("Cursor on Studio Mac");
    expect(oauthClientDisplayName(client!)).toContain(registration.client.clientId.slice(-6));
    expect(oauthClientDisplayName(client!)).toContain("Cursor on Studio Mac");
  });

  it("bounds dynamic client registration and lets revoked clients free capacity", async () => {
    const storePath = path.join(dataDirectory, "mcp-oauth.json");
    const { writeFile } = await import("node:fs/promises");
    const store = {
      version: 1,
      clients: Array.from({ length: 500 }, (_, index) => ({ clientId: `client-${index}`, clientName: `Client ${index}`, redirectUris: ["https://client.example/callback"], createdAt: new Date().toISOString(), revokedAt: null })),
      authorizationCodes: [],
      accessTokens: [],
      refreshTokens: [],
      authorizationRequests: [],
    };
    await writeFile(storePath, JSON.stringify(store), "utf8");

    await expect(registerOAuthClient({ clientName: "Overflow", redirectUris: ["https://client.example/callback"] }))
      .rejects.toThrow(/registration limit/i);

    store.clients[0]!.revokedAt = new Date().toISOString();
    await writeFile(storePath, JSON.stringify(store), "utf8");
    const registration = await registerOAuthClient({ clientName: "Approved", redirectUris: ["https://client.example/callback"] });
    expect(registration.client.clientName).toBe("Approved");
  });

  it("removes revoked clients and their token records from the persistent store", async () => {
    const { registration } = await issueTokens(["notes:read"]);
    expect(await revokeOAuthClient(registration.client.clientId)).toBe(true);
    const store = JSON.parse(await (await import("node:fs/promises")).readFile(path.join(dataDirectory, "mcp-oauth.json"), "utf8")) as {
      clients: unknown[];
      accessTokens: unknown[];
      refreshTokens: unknown[];
    };
    expect(store.clients).toHaveLength(0);
    expect(store.accessTokens).toHaveLength(0);
    expect(store.refreshTokens).toHaveLength(0);
  });

  it("repairs permissions on a legacy OAuth store when loaded", async () => {
    await registerOAuthClient({ clientName: "Permissions", redirectUris: ["https://client.example/callback"] });
    const storePath = path.join(dataDirectory, "mcp-oauth.json");
    await chmod(dataDirectory, 0o755);
    await chmod(storePath, 0o644);

    await listOAuthClients();

    expect((await stat(dataDirectory)).mode & 0o777).toBe(0o700);
    expect((await stat(storePath)).mode & 0o777).toBe(0o600);
  });
});
