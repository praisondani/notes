import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateMcpRequest, consumeMcpRateLimit } from "@/lib/mcp-auth";
import { buildMcpWwwAuthenticate } from "@/lib/mcp-oauth";
import { createMcpServer } from "@/mcp/server";

function configuredList(name: string): string[] {
  return [...new Set((process.env[name] ?? "").split(",").map((value) => value.trim()).filter(Boolean))];
}

function configuredHosts(): string[] {
  const explicit = configuredList("MCP_ALLOWED_HOSTS");
  if (explicit.length) return explicit;
  const appUrl = process.env.APP_URL?.trim();
  if (!appUrl) return [];
  try {
    return [new URL(appUrl).host];
  } catch {
    return [];
  }
}

function originIsAllowed(request: Request, allowedOrigins: string[]): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return allowedOrigins.length > 0 && allowedOrigins.includes(origin);
}

function withCors(response: Response, request: Request, allowedOrigins: string[]): Response {
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins.includes(origin)) return response;
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, MCP-Protocol-Version, Last-Event-ID");
  headers.set("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
  headers.set("Access-Control-Expose-Headers", "Mcp-Session-Id, WWW-Authenticate");
  headers.append("Vary", "Origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function jsonError(message: string, status: number, request: Request, allowedOrigins: string[], headers?: HeadersInit): Response {
  return withCors(Response.json({ error: message }, { status, headers }), request, allowedOrigins);
}

export async function handleMcpRequest(request: Request): Promise<Response> {
  const allowedOrigins = configuredList("MCP_ALLOWED_ORIGINS");
  if (!originIsAllowed(request, allowedOrigins)) {
    return jsonError("Origin is not allowed", 403, request, allowedOrigins);
  }

  if (request.method === "OPTIONS") {
    return withCors(new Response(null, { status: 204 }), request, allowedOrigins);
  }

  const authentication = await authenticateMcpRequest(request);
  if (!authentication.ok) {
    const headers = new Headers();
    if (authentication.status === 401) headers.set("WWW-Authenticate", buildMcpWwwAuthenticate(request, authentication.message === "Invalid MCP credentials"));
    return jsonError(authentication.message, authentication.status, request, allowedOrigins, headers);
  }

  const rate = consumeMcpRateLimit(authentication.context);
  if (!rate.allowed) {
    const headers = new Headers({ "Retry-After": String(rate.retryAfter) });
    return jsonError("MCP rate limit exceeded", 429, request, allowedOrigins, headers);
  }

  const allowedHosts = configuredHosts();
  if (!allowedHosts.length) {
    return jsonError("MCP host allowlist is not configured", 503, request, allowedOrigins);
  }

  const server = createMcpServer(authentication.context);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    allowedHosts,
    allowedOrigins: allowedOrigins.length ? allowedOrigins : undefined,
    enableDnsRebindingProtection: true,
  });

  try {
    await server.connect(transport);
    return withCors(await transport.handleRequest(request), request, allowedOrigins);
  } catch {
    return jsonError("MCP request failed", 500, request, allowedOrigins);
  }
}
