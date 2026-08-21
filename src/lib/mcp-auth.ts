import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const MCP_SCOPES = ["notes:read", "notes:write"] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

type StoredMcpToken = {
  id: string;
  label: string;
  tokenHash: string;
  tokenPrefix: string;
  scopes: McpScope[];
  createdAt: string;
  revokedAt?: string | null;
};

export type McpAuthContext = {
  tokenId: string;
  tokenPrefix: string;
  scopes: ReadonlySet<McpScope>;
  source: "environment" | "file" | "stdio";
};

export type McpAuthFailure = {
  ok: false;
  status: 401 | 503;
  message: "Authentication required" | "Invalid MCP credentials" | "MCP authentication is not configured";
};

export type McpAuthResult =
  | { ok: true; context: McpAuthContext }
  | McpAuthFailure;

const DEFAULT_TOKEN_SCOPES: McpScope[] = ["notes:read"];
const TOKEN_FILE_NAME = "mcp-tokens.json";
const MAX_TOKEN_LENGTH = 2_048;

function dataDirectory(): string {
  return path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIR?.trim() || path.join(process.cwd(), "data"));
}

function tokenFilePath(): string {
  return path.join(dataDirectory(), TOKEN_FILE_NAME);
}

function parseScopes(value: string | undefined, fallback: McpScope[]): McpScope[] {
  if (value === undefined) return [...fallback];
  const scopes = [...new Set(value.split(",").map((scope) => scope.trim()).filter(Boolean))];
  if (!scopes.length || scopes.some((scope) => !MCP_SCOPES.includes(scope as McpScope))) throw new Error("Invalid MCP scopes");
  return scopes as McpScope[];
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function hashesMatch(left: string, right: string): boolean {
  const actual = Buffer.from(left, "hex");
  const expected = Buffer.from(right, "hex");
  return actual.length === expected.length && actual.length > 0 && timingSafeEqual(actual, expected);
}

function parseBearerToken(request: Request): string | null {
  const value = request.headers.get("authorization")?.trim() ?? "";
  if (!value) return null;
  const match = /^Bearer\s+([^\s]+)$/i.exec(value);
  if (!match || match[1].length > MAX_TOKEN_LENGTH) return null;
  return match[1];
}

function validStoredToken(value: unknown): value is StoredMcpToken {
  if (!value || typeof value !== "object") return false;
  const token = value as Partial<StoredMcpToken>;
  return typeof token.id === "string"
    && typeof token.label === "string"
    && typeof token.tokenHash === "string"
    && /^[a-f0-9]{64}$/.test(token.tokenHash)
    && typeof token.tokenPrefix === "string"
    && Array.isArray(token.scopes)
    && token.scopes.length > 0
    && token.scopes.every((scope) => MCP_SCOPES.includes(scope as McpScope))
    && typeof token.createdAt === "string";
}

async function loadStoredTokens(): Promise<StoredMcpToken[]> {
  try {
    const raw = await readFile(tokenFilePath(), "utf8");
    const parsed = JSON.parse(raw) as { version?: number; tokens?: unknown };
    if (parsed.version !== 1 || !Array.isArray(parsed.tokens)) throw new Error("Invalid MCP token store");
    return parsed.tokens.filter(validStoredToken);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function hasMcpScope(context: McpAuthContext, scope: McpScope): boolean {
  return context.scopes.has(scope);
}

export async function authenticateMcpRequest(request: Request): Promise<McpAuthResult> {
  const providedToken = parseBearerToken(request);
  if (!providedToken) {
    return { ok: false, status: 401, message: request.headers.has("authorization") ? "Invalid MCP credentials" : "Authentication required" };
  }

  try {
    const environmentToken = process.env.MCP_ACCESS_TOKEN?.trim() ?? "";
    const storedTokens = await loadStoredTokens();
    let matched: McpAuthContext | undefined;

    if (environmentToken.length >= 32 && hashesMatch(hashToken(providedToken), hashToken(environmentToken))) {
      matched = {
        tokenId: "environment",
        tokenPrefix: environmentToken.slice(0, 12),
        scopes: new Set(parseScopes(process.env.MCP_ACCESS_TOKEN_SCOPES, DEFAULT_TOKEN_SCOPES)),
        source: "environment",
      };
    }

    for (const token of storedTokens) {
      const isRevoked = Boolean(token.revokedAt);
      if (!isRevoked && hashesMatch(hashToken(providedToken), token.tokenHash)) {
        matched = {
          tokenId: token.id,
          tokenPrefix: token.tokenPrefix,
          scopes: new Set(token.scopes),
          source: "file",
        };
      }
    }

    if (matched) return { ok: true, context: matched };
    if (!environmentToken && !storedTokens.length) return { ok: false, status: 503, message: "MCP authentication is not configured" };
    return { ok: false, status: 401, message: "Invalid MCP credentials" };
  } catch {
    return { ok: false, status: 503, message: "MCP authentication is not configured" };
  }
}

type RateBucket = { startedAt: number; count: number };
const rateBuckets = new Map<string, RateBucket>();

function rateLimitPerMinute(): number {
  const value = Number.parseInt(process.env.MCP_RATE_LIMIT_PER_MINUTE ?? "120", 10);
  return Number.isFinite(value) ? Math.min(Math.max(value, 10), 10_000) : 120;
}

export function consumeMcpRateLimit(context: McpAuthContext, now = Date.now()): { allowed: true } | { allowed: false; retryAfter: number } {
  const key = `${context.source}:${context.tokenId}`;
  const current = rateBuckets.get(key);
  if (!current || now - current.startedAt >= 60_000) {
    rateBuckets.set(key, { startedAt: now, count: 1 });
    return { allowed: true };
  }
  if (current.count >= rateLimitPerMinute()) {
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((60_000 - (now - current.startedAt)) / 1_000)) };
  }
  current.count += 1;
  return { allowed: true };
}
