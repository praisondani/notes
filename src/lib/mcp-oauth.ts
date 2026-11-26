import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { DEFAULT_MCP_SCOPES, MCP_SCOPES, normalizeMcpScopes, uniqueMcpScopes, type McpScope } from "@/lib/mcp-scopes";

const STORE_VERSION = 1;
const AUTHORIZATION_CODE_TTL_MS = 5 * 60 * 1_000;
const AUTHORIZATION_REQUEST_TTL_MS = 10 * 60 * 1_000;
const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const DEFAULT_REFRESH_TOKEN_TTL_DAYS = 180;
const MAX_REDIRECT_URIS = 10;
const MAX_REGISTERED_CLIENTS = 500;
const MAX_PENDING_AUTHORIZATION_REQUESTS = 1_000;
const MAX_AUTHORIZATION_CODES = 5_000;
const MAX_ACTIVE_ACCESS_TOKENS = 5_000;
const MAX_ACTIVE_REFRESH_TOKENS = 5_000;
const MAX_REVOKED_TOKEN_HISTORY = 5_000;
const REVOKED_TOKEN_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const UNUSED_CLIENT_TTL_MS = 60 * 60 * 1_000;

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function accessTokenTtlSeconds(): number {
  return readPositiveInt(process.env.MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS, DEFAULT_ACCESS_TOKEN_TTL_SECONDS);
}

export function refreshTokenTtlMs(): number {
  const days = readPositiveInt(process.env.MCP_OAUTH_REFRESH_TOKEN_TTL_DAYS, DEFAULT_REFRESH_TOKEN_TTL_DAYS);
  return days * 24 * 60 * 60 * 1_000;
}
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const TOKEN_ENDPOINT_AUTH_METHODS = ["none", "client_secret_post", "client_secret_basic"] as const;

export const OAUTH_BROWSER_COOKIE = "notes_oauth_browser";

export type OAuthTokenEndpointAuthMethod = (typeof TOKEN_ENDPOINT_AUTH_METHODS)[number];

type StoredOAuthClient = {
  clientId: string;
  clientName: string;
  clientLabel?: string;
  clientUri?: string;
  redirectUris: string[];
  tokenEndpointAuthMethod: OAuthTokenEndpointAuthMethod;
  clientSecretHash?: string;
  clientSecretPrefix?: string;
  createdAt: string;
  revokedAt?: string | null;
  scopes?: McpScope[];
};

type StoredAuthorizationCode = {
  codeHash: string;
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: McpScope[];
  resource: string;
  createdAt: string;
  expiresAt: number;
};

type StoredAccessToken = {
  tokenId: string;
  tokenHash: string;
  tokenPrefix: string;
  clientId: string;
  userId: string;
  scopes: McpScope[];
  resource: string;
  createdAt: string;
  expiresAt: number;
  revokedAt?: string | null;
};

type StoredRefreshToken = {
  tokenId: string;
  tokenHash: string;
  tokenPrefix: string;
  clientId: string;
  userId: string;
  scopes: McpScope[];
  resource: string;
  familyId: string;
  createdAt: string;
  expiresAt: number;
  revokedAt?: string | null;
};

type StoredAuthorizationRequest = {
  transactionId: string;
  browserSecretHash: string;
  clientId: string;
  redirectUri: string;
  state?: string;
  codeChallenge: string;
  scopes: McpScope[];
  resource: string;
  createdAt: string;
  expiresAt: number;
};

type OAuthStore = {
  version: 1;
  clients: StoredOAuthClient[];
  authorizationCodes: StoredAuthorizationCode[];
  accessTokens: StoredAccessToken[];
  refreshTokens: StoredRefreshToken[];
  authorizationRequests: StoredAuthorizationRequest[];
  migrations?: {
    refreshScopesHealedAt?: string;
  };
};

export type OAuthClient = {
  clientId: string;
  clientName: string;
  clientLabel?: string;
  clientUri?: string;
  redirectUris: string[];
  tokenEndpointAuthMethod: OAuthTokenEndpointAuthMethod;
  scopes?: McpScope[];
  createdAt: string;
};

export function oauthClientDisplayName(client: Pick<OAuthClient, "clientId" | "clientName" | "clientLabel">): string {
  const base = client.clientLabel?.trim() || client.clientName;
  const suffix = client.clientId.slice(-6);
  return suffix ? `${base} · ${suffix}` : base;
}

export function oauthClientAttributionName(client: Pick<OAuthClient, "clientName" | "clientLabel">): string {
  return client.clientLabel?.trim() || client.clientName;
}

export type OAuthClientRegistrationInput = {
  clientName?: string;
  clientUri?: string;
  redirectUris: string[];
  tokenEndpointAuthMethod?: OAuthTokenEndpointAuthMethod;
  scopes?: McpScope[];
};

export type OAuthRegistrationResult = {
  client: OAuthClient;
  clientSecret?: string;
};

export type OAuthAuthorizationRequestInput = {
  clientId: string;
  redirectUri: string;
  state?: string;
  codeChallenge: string;
  scopes?: McpScope[];
  resource: string;
};

export type OAuthAuthorizationRequestView = {
  transactionId: string;
  clientId: string;
  clientName: string;
  clientLabel?: string;
  clientUri?: string;
  redirectUri: string;
  state?: string;
  codeChallenge: string;
  scopes: McpScope[];
  resource: string;
  expiresAt: number;
};

export type OAuthAuthorizationCompletion = {
  redirectUri: string;
  state?: string;
  code?: string;
  error?: "access_denied";
};

export type OAuthTokenSet = {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  scope: McpScope[];
};

export type OAuthAccessContext = {
  tokenId: string;
  tokenPrefix: string;
  userId: string;
  scopes: McpScope[];
  source: "oauth";
  clientId: string;
  clientName: string;
};

export type OAuthClientView = OAuthClient & {
  activeTokenCount: number;
  grantedScopes: McpScope[];
  accessTokenExpiresAt: string | null;
  refreshTokenExpiresAt: string | null;
};

export class OAuthProtocolError extends Error {
  constructor(public readonly code: "invalid_request" | "invalid_client" | "invalid_grant" | "invalid_scope" | "unsupported_grant_type" | "unsupported_response_type" | "access_denied", message: string) {
    super(message);
    this.name = "OAuthProtocolError";
  }
}

function dataDirectory(): string {
  return path.resolve(process.env.DATA_DIR?.trim() || path.join(process.cwd(), "data"));
}

function storePath(): string {
  return path.join(dataDirectory(), "mcp-oauth.json");
}

async function secureDataDirectory(): Promise<void> {
  const directory = dataDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (directory !== path.parse(directory).root) await chmod(directory, 0o700);
}

function emptyStore(): OAuthStore {
  return {
    version: STORE_VERSION,
    clients: [],
    authorizationCodes: [],
    accessTokens: [],
    refreshTokens: [],
    authorizationRequests: [],
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isStore(value: unknown): value is OAuthStore {
  if (!isObject(value) || value.version !== STORE_VERSION) return false;
  return ["clients", "authorizationCodes", "accessTokens", "refreshTokens", "authorizationRequests"].every((key) => Array.isArray(value[key]));
}

async function readStore(): Promise<OAuthStore> {
  try {
    const filename = storePath();
    const raw = await readFile(filename, "utf8");
    await secureDataDirectory();
    await chmod(filename, 0o600);
    const parsed = JSON.parse(raw) as unknown;
    if (!isStore(parsed)) throw new Error("Invalid MCP OAuth store");
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
    throw error;
  }
}

async function readStoreForMutation(): Promise<OAuthStore> {
  const store = await readStore();
  healRefreshTokenScopes(store);
  return store;
}

async function writeStore(store: OAuthStore): Promise<void> {
  const filename = storePath();
  await secureDataDirectory();
  const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, filename);
  await chmod(filename, 0o600);
}

let queuedMutation: Promise<unknown> = Promise.resolve();

function withMutation<T>(operation: (store: OAuthStore) => Promise<T> | T): Promise<T> {
  const next = queuedMutation.then(async () => {
    const store = await readStoreForMutation();
    pruneOAuthStore(store);
    const result = await operation(store);
    pruneOAuthStore(store);
    await writeStore(store);
    return result;
  });
  queuedMutation = next.then(() => undefined, () => undefined);
  return next;
}

function nowIso(now = Date.now()): string {
  return new Date(now).toISOString();
}

function randomValue(prefix: string): string {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}

function hashValue(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hashesMatch(left: string, right: string): boolean {
  const actual = Buffer.from(left, "hex");
  const expected = Buffer.from(right, "hex");
  return actual.length === expected.length && actual.length > 0 && timingSafeEqual(actual, expected);
}

function normalizeResource(resource: string): string {
  try {
    const parsed = new URL(resource);
    if (!parsed.protocol || !parsed.host || parsed.hash || parsed.username || parsed.password) throw new Error("Invalid resource");
    return parsed.toString().replace(/\/$/, "");
  } catch {
    throw new OAuthProtocolError("invalid_request", "The MCP resource is invalid.");
  }
}

function publicOrigin(fallbackOrigin?: string): string {
  const configured = process.env.APP_URL?.trim();
  try {
    return new URL(configured || fallbackOrigin || "http://localhost:3000").origin;
  } catch {
    return new URL(fallbackOrigin || "http://localhost:3000").origin;
  }
}

export function mcpResourceUrl(origin = publicOrigin()): string {
  const configured = process.env.MCP_RESOURCE_URL?.trim();
  if (configured) return normalizeResource(configured);
  return normalizeResource(new URL("/api/mcp", publicOrigin(origin)).toString());
}

export function protectedResourceMetadataUrl(origin = publicOrigin()): string {
  return new URL("/.well-known/oauth-protected-resource", publicOrigin(origin)).toString();
}

export function buildMcpWwwAuthenticate(request: Request, invalidToken = false): string {
  const origin = publicOrigin(new URL(request.url).origin);
  const parts = ["Bearer"];
  if (invalidToken) parts.push('error="invalid_token"');
  parts.push(`resource_metadata="${protectedResourceMetadataUrl(origin)}"`);
  parts.push('scope="notes:read notes:write"');
  return `${parts[0]} ${parts.slice(1).join(", ")}`;
}

export function protectedResourceMetadata(origin = publicOrigin()): Record<string, unknown> {
  const normalizedOrigin = publicOrigin(origin);
  return {
    resource: mcpResourceUrl(normalizedOrigin),
    authorization_servers: [normalizedOrigin],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "Notes",
    resource_documentation: new URL("/settings", normalizedOrigin).toString(),
  };
}

export function authorizationServerMetadata(origin = publicOrigin()): Record<string, unknown> {
  const normalizedOrigin = publicOrigin(origin);
  return {
    issuer: normalizedOrigin,
    authorization_endpoint: new URL("/oauth/authorize", normalizedOrigin).toString(),
    token_endpoint: new URL("/oauth/token", normalizedOrigin).toString(),
    registration_endpoint: new URL("/oauth/register", normalizedOrigin).toString(),
    revocation_endpoint: new URL("/oauth/revoke", normalizedOrigin).toString(),
    scopes_supported: [...MCP_SCOPES],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: [...TOKEN_ENDPOINT_AUTH_METHODS],
    code_challenge_methods_supported: ["S256"],
    service_documentation: new URL("/settings", normalizedOrigin).toString(),
  };
}

function isValidRedirectUri(value: string): boolean {
  if (value.length > 2_048) return false;
  try {
    const parsed = new URL(value);
    if (parsed.hash || parsed.username || parsed.password) return false;
    if (parsed.protocol === "https:") return true;
    return parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

export function redirectUriMatches(requested: string, registered: string): boolean {
  if (requested === registered) return true;
  if (!isValidRedirectUri(requested) || !isValidRedirectUri(registered)) return false;
  try {
    const requestedUrl = new URL(requested);
    const registeredUrl = new URL(registered);
    if (!LOOPBACK_HOSTS.has(requestedUrl.hostname) || !LOOPBACK_HOSTS.has(registeredUrl.hostname)) return false;
    return requestedUrl.protocol === registeredUrl.protocol
      && requestedUrl.hostname === registeredUrl.hostname
      && requestedUrl.pathname === registeredUrl.pathname
      && requestedUrl.search === registeredUrl.search;
  } catch {
    return false;
  }
}

function validateRedirectUris(redirectUris: string[]): string[] {
  const unique = [...new Set(redirectUris.map((uri) => uri.trim()).filter(Boolean))];
  if (!unique.length || unique.length > MAX_REDIRECT_URIS || unique.some((uri) => !isValidRedirectUri(uri))) {
    throw new OAuthProtocolError("invalid_request", "redirect_uris must contain valid HTTPS or loopback HTTP URLs.");
  }
  return unique;
}

function validateClientName(value: string | undefined): string {
  const name = value?.trim() || "MCP client";
  if (name.length > 200) throw new OAuthProtocolError("invalid_request", "client_name is too long.");
  return name;
}

function validateClientLabel(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const label = value.trim();
  if (!label) return undefined;
  if (label.length > 80) throw new OAuthProtocolError("invalid_request", "client label is too long.");
  return label;
}

function validateClientUri(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    const loopbackHttp = parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname);
    if ((parsed.protocol !== "https:" && !loopbackHttp) || parsed.hash || parsed.username || parsed.password) throw new Error("Invalid client URI");
    return parsed.toString();
  } catch {
    throw new OAuthProtocolError("invalid_request", "client_uri must be an HTTPS or loopback HTTP URL.");
  }
}

function validateCodeChallenge(value: string): string {
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(value)) throw new OAuthProtocolError("invalid_request", "code_challenge must use S256 PKCE.");
  return value;
}

export function createCodeChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier, "utf8").digest("base64url");
}

export function createOAuthBrowserSecret(): string {
  return randomValue("notes_browser_");
}

export function parseOAuthScopeString(value: string | null | undefined): McpScope[] | undefined {
  if (value === undefined || value === null || !value.trim()) return undefined;
  return normalizeMcpScopes(value.split(/\s+/));
}

function toPublicClient(client: StoredOAuthClient): OAuthClient {
  return {
    clientId: client.clientId,
    clientName: client.clientName,
    ...(client.clientLabel ? { clientLabel: client.clientLabel } : {}),
    ...(client.clientUri ? { clientUri: client.clientUri } : {}),
    redirectUris: [...client.redirectUris],
    tokenEndpointAuthMethod: client.tokenEndpointAuthMethod,
    ...(client.scopes ? { scopes: [...client.scopes] } : {}),
    createdAt: client.createdAt,
  };
}

function findClient(store: OAuthStore, clientId: string): StoredOAuthClient {
  const client = store.clients.find((candidate) => candidate.clientId === clientId && !candidate.revokedAt);
  if (!client) throw new OAuthProtocolError("invalid_client", "Unknown OAuth client.");
  return client;
}

function ensureRequestedScopes(requested: McpScope[] | undefined, allowed: McpScope[] | undefined, fallback: McpScope[] = DEFAULT_MCP_SCOPES): McpScope[] {
  const scopes = normalizeMcpScopes(requested, fallback);
  if (allowed && scopes.some((scope) => !allowed.includes(scope))) {
    throw new OAuthProtocolError("invalid_scope", "The requested MCP scope is not allowed for this client.");
  }
  return scopes;
}

function historicalScopesForClient(store: OAuthStore, clientId: string, resource: string): McpScope[] {
  const scopes: McpScope[] = [];
  for (const token of store.accessTokens) {
    if (token.clientId === clientId && token.resource === resource) scopes.push(...token.scopes);
  }
  for (const token of store.refreshTokens) {
    if (token.clientId === clientId && token.resource === resource) scopes.push(...token.scopes);
  }
  return uniqueMcpScopes(scopes);
}

function resolveRefreshScopes(current: StoredRefreshToken, requested: McpScope[] | undefined): McpScope[] {
  const granted = uniqueMcpScopes(current.scopes);
  if (!granted.length) throw new OAuthProtocolError("invalid_scope", "The refresh token has no usable scopes.");
  // RFC 6749 §6: omitted scope means the originally granted scope.
  if (requested === undefined) return granted;
  return ensureRequestedScopes(requested, granted, granted);
}

function healRefreshTokenScopes(store: OAuthStore): boolean {
  if (store.migrations?.refreshScopesHealedAt) return false;
  for (const refresh of store.refreshTokens) {
    if (refresh.revokedAt) continue;
    const historical = historicalScopesForClient(store, refresh.clientId, refresh.resource);
    const healed = uniqueMcpScopes([...refresh.scopes, ...historical]);
    if (healed.join(" ") !== refresh.scopes.join(" ")) {
      console.info(
        `[mcp-oauth] healed refresh scopes client=${refresh.clientId} from=${refresh.scopes.join(" ")} to=${healed.join(" ")}`,
      );
      refresh.scopes = healed;
    }
  }
  store.migrations = { ...store.migrations, refreshScopesHealedAt: nowIso() };
  return true;
}

function pruneOAuthStore(store: OAuthStore, now = Date.now()): void {
  const retainRevoked = (revokedAt: string | null | undefined) => Boolean(revokedAt && Date.parse(revokedAt) > now - REVOKED_TOKEN_RETENTION_MS);
  const referencedClientIds = new Set<string>();
  for (const request of store.authorizationRequests) if (request.expiresAt > now) referencedClientIds.add(request.clientId);
  for (const code of store.authorizationCodes) if (code.expiresAt > now) referencedClientIds.add(code.clientId);
  for (const token of store.accessTokens) {
    if (token.revokedAt ? retainRevoked(token.revokedAt) : token.expiresAt > Math.floor(now / 1_000)) referencedClientIds.add(token.clientId);
  }
  for (const token of store.refreshTokens) {
    if (token.revokedAt ? retainRevoked(token.revokedAt) : token.expiresAt > now) referencedClientIds.add(token.clientId);
  }
  store.clients = store.clients.filter((client) => !client.revokedAt
    && (referencedClientIds.has(client.clientId) || Date.parse(client.createdAt) > now - UNUSED_CLIENT_TTL_MS));
  const activeClientIds = new Set(store.clients.map((client) => client.clientId));
  const recentRevoked = <T extends { revokedAt?: string | null }>(tokens: T[]): T[] => tokens
    .filter((token) => retainRevoked(token.revokedAt))
    .sort((left, right) => Date.parse(right.revokedAt ?? "") - Date.parse(left.revokedAt ?? ""))
    .slice(0, MAX_REVOKED_TOKEN_HISTORY);
  store.authorizationRequests = store.authorizationRequests.filter((request) => activeClientIds.has(request.clientId) && request.expiresAt > now);
  store.authorizationCodes = store.authorizationCodes.filter((code) => activeClientIds.has(code.clientId) && code.expiresAt > now);
  store.accessTokens = [
    ...recentRevoked(store.accessTokens.filter((token) => activeClientIds.has(token.clientId))),
    ...store.accessTokens.filter((token) => activeClientIds.has(token.clientId) && !token.revokedAt && token.expiresAt > Math.floor(now / 1_000)),
  ];
  store.refreshTokens = [
    ...recentRevoked(store.refreshTokens.filter((token) => activeClientIds.has(token.clientId))),
    ...store.refreshTokens.filter((token) => activeClientIds.has(token.clientId) && !token.revokedAt && token.expiresAt > now),
  ];
}

export async function registerOAuthClient(input: OAuthClientRegistrationInput): Promise<OAuthRegistrationResult> {
  const redirectUris = validateRedirectUris(input.redirectUris);
  const authMethod = input.tokenEndpointAuthMethod ?? "none";
  if (!TOKEN_ENDPOINT_AUTH_METHODS.includes(authMethod)) throw new OAuthProtocolError("invalid_request", "Unsupported token endpoint authentication method.");
  const clientSecret = authMethod === "none" ? undefined : randomValue("notes_secret_");
  const client: StoredOAuthClient = {
    clientId: randomValue("notes_client_"),
    clientName: validateClientName(input.clientName),
    clientUri: validateClientUri(input.clientUri),
    redirectUris,
    tokenEndpointAuthMethod: authMethod,
    ...(clientSecret ? { clientSecretHash: hashValue(clientSecret), clientSecretPrefix: clientSecret.slice(0, 16) } : {}),
    createdAt: nowIso(),
    revokedAt: null,
    ...(input.scopes ? { scopes: normalizeMcpScopes(input.scopes) } : {}),
  };
  await withMutation((store) => {
    if (store.clients.filter((candidate) => !candidate.revokedAt).length >= MAX_REGISTERED_CLIENTS) {
      throw new OAuthProtocolError("invalid_request", "This Notes deployment has reached its OAuth client registration limit. Revoke an unused connection in Settings and try again.");
    }
    store.clients.push(client);
  });
  return { client: toPublicClient(client), ...(clientSecret ? { clientSecret } : {}) };
}

export async function getOAuthClient(clientId: string): Promise<OAuthClient | null> {
  const store = await readStore();
  const client = store.clients.find((candidate) => candidate.clientId === clientId && !candidate.revokedAt);
  return client ? toPublicClient(client) : null;
}

export async function getOAuthClientRecord(clientId: string): Promise<StoredOAuthClient | null> {
  const store = await readStore();
  return store.clients.find((candidate) => candidate.clientId === clientId && !candidate.revokedAt) ?? null;
}

export function verifyOAuthClientSecret(client: StoredOAuthClient, clientSecret: string | undefined): boolean {
  if (client.tokenEndpointAuthMethod === "none") return !clientSecret;
  return Boolean(clientSecret && client.clientSecretHash && hashesMatch(hashValue(clientSecret), client.clientSecretHash));
}

export async function beginAuthorizationRequest(input: OAuthAuthorizationRequestInput, browserSecret: string): Promise<{ transactionId: string }> {
  const store = await readStore();
  const client = findClient(store, input.clientId);
  if (!client.redirectUris.some((registered) => redirectUriMatches(input.redirectUri, registered))) {
    throw new OAuthProtocolError("invalid_request", "The redirect URI is not registered for this client.");
  }
  const resource = normalizeResource(input.resource);
  if (resource !== mcpResourceUrl()) throw new OAuthProtocolError("invalid_request", "The MCP resource is invalid.");
  const scopes = ensureRequestedScopes(input.scopes, client.scopes, client.scopes ?? DEFAULT_MCP_SCOPES);
  const codeChallenge = validateCodeChallenge(input.codeChallenge);
  if (input.state && input.state.length > 2_048) throw new OAuthProtocolError("invalid_request", "state is too long.");
  const transactionId = randomValue("notes_tx_");
  await withMutation((nextStore) => {
    if (nextStore.authorizationRequests.length >= MAX_PENDING_AUTHORIZATION_REQUESTS) {
      throw new OAuthProtocolError("invalid_request", "This Notes deployment has reached its pending OAuth request limit. Try again later.");
    }
    nextStore.authorizationRequests.push({
      transactionId,
      browserSecretHash: hashValue(browserSecret),
      clientId: client.clientId,
      redirectUri: input.redirectUri,
      ...(input.state ? { state: input.state } : {}),
      codeChallenge,
      scopes,
      resource,
      createdAt: nowIso(),
      expiresAt: Date.now() + AUTHORIZATION_REQUEST_TTL_MS,
    });
  });
  return { transactionId };
}

export async function getAuthorizationRequest(transactionId: string, browserSecret: string): Promise<OAuthAuthorizationRequestView | null> {
  const store = await readStore();
  const pending = store.authorizationRequests.find((candidate) => candidate.transactionId === transactionId);
  if (!pending || pending.expiresAt <= Date.now() || !hashesMatch(hashValue(browserSecret), pending.browserSecretHash)) return null;
  const client = store.clients.find((candidate) => candidate.clientId === pending.clientId && !candidate.revokedAt);
  if (!client) return null;
  return {
    transactionId: pending.transactionId,
    clientId: client.clientId,
    clientName: client.clientName,
    ...(client.clientLabel ? { clientLabel: client.clientLabel } : {}),
    ...(client.clientUri ? { clientUri: client.clientUri } : {}),
    redirectUri: pending.redirectUri,
    ...(pending.state ? { state: pending.state } : {}),
    codeChallenge: pending.codeChallenge,
    scopes: [...pending.scopes],
    resource: pending.resource,
    expiresAt: pending.expiresAt,
  };
}

export async function approveAuthorizationRequest(
  transactionId: string,
  browserSecret: string,
  userId: string,
  approved = true,
  options?: { clientLabel?: string },
): Promise<OAuthAuthorizationCompletion> {
  return withMutation((store) => {
    const index = store.authorizationRequests.findIndex((candidate) => candidate.transactionId === transactionId);
    const pending = index >= 0 ? store.authorizationRequests[index] : undefined;
    if (!pending || pending.expiresAt <= Date.now() || !hashesMatch(hashValue(browserSecret), pending.browserSecretHash)) {
      throw new OAuthProtocolError("invalid_request", "The authorization request is invalid or expired.");
    }
    store.authorizationRequests.splice(index, 1);
    if (!approved) return { redirectUri: pending.redirectUri, ...(pending.state ? { state: pending.state } : {}), error: "access_denied" as const };
    const label = validateClientLabel(options?.clientLabel);
    if (label) {
      const client = store.clients.find((candidate) => candidate.clientId === pending.clientId && !candidate.revokedAt);
      if (client) client.clientLabel = label;
    }
    if (store.authorizationCodes.length >= MAX_AUTHORIZATION_CODES) {
      throw new OAuthProtocolError("invalid_request", "This Notes deployment has reached its authorization code limit. Try again later.");
    }
    const code = randomValue("notes_code_");
    store.authorizationCodes.push({
      codeHash: hashValue(code),
      clientId: pending.clientId,
      userId,
      redirectUri: pending.redirectUri,
      codeChallenge: pending.codeChallenge,
      scopes: [...pending.scopes],
      resource: pending.resource,
      createdAt: nowIso(),
      expiresAt: Date.now() + AUTHORIZATION_CODE_TTL_MS,
    });
    return { redirectUri: pending.redirectUri, ...(pending.state ? { state: pending.state } : {}), code };
  });
}

function issueTokenSet(
  store: OAuthStore,
  clientId: string,
  userId: string,
  scopes: McpScope[],
  resource: string,
  familyId = randomValue("notes_family_"),
): OAuthTokenSet {
  const now = Date.now();
  if (store.accessTokens.filter((token) => !token.revokedAt && token.expiresAt > Math.floor(now / 1_000)).length >= MAX_ACTIVE_ACCESS_TOKENS
    || store.refreshTokens.filter((token) => !token.revokedAt && token.expiresAt > now).length >= MAX_ACTIVE_REFRESH_TOKENS) {
    throw new OAuthProtocolError("invalid_request", "This Notes deployment has reached its active OAuth token limit.");
  }
  const accessToken = randomValue("cnd_oauth_");
  const refreshToken = randomValue("cnd_oauth_refresh_");
  const createdAt = nowIso();
  const accessTokenId = randomValue("notes_access_");
  const refreshTokenId = randomValue("notes_refresh_");
  const accessTtlSeconds = accessTokenTtlSeconds();
  const refreshTtl = refreshTokenTtlMs();
  store.accessTokens.push({
    tokenId: accessTokenId,
    tokenHash: hashValue(accessToken),
    tokenPrefix: accessToken.slice(0, 16),
    clientId,
    userId,
    scopes: [...scopes],
    resource,
    createdAt,
    expiresAt: Math.floor(now / 1_000) + accessTtlSeconds,
    revokedAt: null,
  });
  store.refreshTokens.push({
    tokenId: refreshTokenId,
    tokenHash: hashValue(refreshToken),
    tokenPrefix: refreshToken.slice(0, 20),
    clientId,
    userId,
    scopes: [...scopes],
    resource,
    familyId,
    createdAt,
    expiresAt: now + refreshTtl,
    revokedAt: null,
  });
  console.info(
    `[mcp-oauth] issued tokens client=${clientId} scopes=${scopes.join(" ")} access_ttl_s=${accessTtlSeconds} refresh_expires_at=${new Date(now + refreshTtl).toISOString()}`,
  );
  return { accessToken, refreshToken, tokenType: "Bearer", expiresIn: accessTtlSeconds, scope: [...scopes] };
}

function verifyClientForToken(client: StoredOAuthClient, clientSecret: string | undefined): void {
  if (!verifyOAuthClientSecret(client, clientSecret)) throw new OAuthProtocolError("invalid_client", "OAuth client authentication failed.");
}

export async function exchangeAuthorizationCode(input: { clientId: string; clientSecret?: string; code: string; codeVerifier: string; redirectUri: string; resource: string }): Promise<OAuthTokenSet> {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(input.codeVerifier)) throw new OAuthProtocolError("invalid_grant", "The PKCE verifier is invalid.");
  const resource = normalizeResource(input.resource);
  return withMutation((store) => {
    const client = findClient(store, input.clientId);
    verifyClientForToken(client, input.clientSecret);
    const codeHash = hashValue(input.code);
    const index = store.authorizationCodes.findIndex((candidate) => hashesMatch(candidate.codeHash, codeHash));
    const code = index >= 0 ? store.authorizationCodes[index] : undefined;
    if (!code || code.clientId !== client.clientId || code.expiresAt <= Date.now() || code.redirectUri !== input.redirectUri) {
      throw new OAuthProtocolError("invalid_grant", "The authorization code is invalid or expired.");
    }
    if (code.resource !== resource || createCodeChallenge(input.codeVerifier) !== code.codeChallenge) {
      throw new OAuthProtocolError("invalid_grant", "The authorization code verification failed.");
    }
    store.authorizationCodes.splice(index, 1);
    return issueTokenSet(store, code.clientId, code.userId, code.scopes, code.resource);
  });
}

export async function exchangeRefreshToken(input: { clientId: string; clientSecret?: string; refreshToken: string; scopes?: McpScope[]; resource: string }): Promise<OAuthTokenSet> {
  const resource = normalizeResource(input.resource);
  return withMutation((store) => {
    const client = findClient(store, input.clientId);
    verifyClientForToken(client, input.clientSecret);
    const tokenHash = hashValue(input.refreshToken);
    const index = store.refreshTokens.findIndex((candidate) => hashesMatch(candidate.tokenHash, tokenHash));
    const current = index >= 0 ? store.refreshTokens[index] : undefined;
    if (!current || current.clientId !== client.clientId || current.revokedAt || current.expiresAt <= Date.now() || current.resource !== resource) {
      throw new OAuthProtocolError("invalid_grant", "Invalid refresh token");
    }
    const scopes = resolveRefreshScopes(current, input.scopes);
    current.revokedAt = nowIso();
    // Sliding renewal: new refresh token inherits the family and gets a fresh TTL.
    return issueTokenSet(store, current.clientId, current.userId, scopes, current.resource, current.familyId);
  });
}

export async function verifyOAuthAccessToken(token: string, resource: string): Promise<OAuthAccessContext | null> {
  const normalizedResource = normalizeResource(resource);
  const store = await readStore();
  const tokenHash = hashValue(token);
  const accessToken = store.accessTokens.find((candidate) => hashesMatch(candidate.tokenHash, tokenHash));
  if (!accessToken || accessToken.revokedAt || accessToken.expiresAt <= Math.floor(Date.now() / 1_000) || accessToken.resource !== normalizedResource) return null;
  const client = store.clients.find((candidate) => candidate.clientId === accessToken.clientId && !candidate.revokedAt);
  if (!client) return null;
  return { 
    tokenId: accessToken.tokenId, 
    tokenPrefix: accessToken.tokenPrefix, 
    userId: accessToken.userId, 
    scopes: [...accessToken.scopes], 
    source: "oauth",
    clientId: client.clientId,
    clientName: oauthClientAttributionName(client),
  };
}

export async function revokeOAuthToken(token: string): Promise<void> {
  await withMutation((store) => {
    const tokenHash = hashValue(token);
    const timestamp = nowIso();
    for (const accessToken of store.accessTokens) {
      if (hashesMatch(accessToken.tokenHash, tokenHash)) accessToken.revokedAt = timestamp;
    }
    for (const refreshToken of store.refreshTokens) {
      if (hashesMatch(refreshToken.tokenHash, tokenHash)) refreshToken.revokedAt = timestamp;
    }
  });
}

export async function listOAuthClients(): Promise<OAuthClientView[]> {
  return withMutation((store) => {
    const nowSeconds = Math.floor(Date.now() / 1_000);
    const nowMs = Date.now();
    return store.clients.filter((client) => !client.revokedAt).map((client) => {
      const activeAccess = store.accessTokens
        .filter((token) => token.clientId === client.clientId && !token.revokedAt && token.expiresAt > nowSeconds)
        .sort((left, right) => right.expiresAt - left.expiresAt);
      const activeRefresh = store.refreshTokens
        .filter((token) => token.clientId === client.clientId && !token.revokedAt && token.expiresAt > nowMs)
        .sort((left, right) => right.expiresAt - left.expiresAt);
      const grantedScopes = uniqueMcpScopes([
        ...(client.scopes ?? []),
        ...activeAccess.flatMap((token) => token.scopes),
        ...activeRefresh.flatMap((token) => token.scopes),
        ...historicalScopesForClient(store, client.clientId, mcpResourceUrl()),
      ]);
      return {
        ...toPublicClient(client),
        scopes: grantedScopes.length ? grantedScopes : client.scopes,
        activeTokenCount: activeAccess.length,
        grantedScopes,
        accessTokenExpiresAt: activeAccess[0] ? new Date(activeAccess[0].expiresAt * 1_000).toISOString() : null,
        refreshTokenExpiresAt: activeRefresh[0] ? new Date(activeRefresh[0].expiresAt).toISOString() : null,
      };
    });
  });
}

export async function revokeOAuthClient(clientId: string): Promise<boolean> {
  return withMutation((store) => {
    const client = store.clients.find((candidate) => candidate.clientId === clientId && !candidate.revokedAt);
    if (!client) return false;
    const timestamp = nowIso();
    client.revokedAt = timestamp;
    for (const token of store.accessTokens) if (token.clientId === clientId) token.revokedAt = timestamp;
    for (const token of store.refreshTokens) if (token.clientId === clientId) token.revokedAt = timestamp;
    store.authorizationRequests = store.authorizationRequests.filter((request) => request.clientId !== clientId);
    return true;
  });
}
