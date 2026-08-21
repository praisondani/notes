import { NextResponse } from "next/server";
import { getOAuthClientRecord, OAuthProtocolError, verifyOAuthClientSecret } from "@/lib/mcp-oauth";

const RATE_WINDOW_MS = 60 * 1_000;
const rateBuckets = new Map<string, { startedAt: number; count: number }>();

export type OAuthClientCredentials = {
  clientId: string;
  clientSecret?: string;
};

function clientAddress(request: Request): string {
  return request.headers.get("x-real-ip")?.trim() || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export function consumeOAuthRateLimit(request: Request, bucket: string, maximum = 60, now = Date.now()): { allowed: true } | { allowed: false; retryAfter: number } {
  const key = `${bucket}:${clientAddress(request)}`;
  const current = rateBuckets.get(key);
  if (!current || now - current.startedAt >= RATE_WINDOW_MS) {
    rateBuckets.set(key, { startedAt: now, count: 1 });
    return { allowed: true };
  }
  if (current.count >= maximum) return { allowed: false, retryAfter: Math.max(1, Math.ceil((RATE_WINDOW_MS - (now - current.startedAt)) / 1_000)) };
  current.count += 1;
  return { allowed: true };
}

function protocolError(code: OAuthProtocolError["code"], message: string): OAuthProtocolError {
  return new OAuthProtocolError(code, message);
}

function decodeBasicCredentials(value: string): OAuthClientCredentials {
  const encoded = value.slice("Basic ".length).trim();
  if (!encoded) throw protocolError("invalid_client", "OAuth client authentication failed.");
  let decoded = "";
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    throw protocolError("invalid_client", "OAuth client authentication failed.");
  }
  const separator = decoded.indexOf(":");
  if (separator <= 0) throw protocolError("invalid_client", "OAuth client authentication failed.");
  const clientId = decoded.slice(0, separator);
  const clientSecret = decoded.slice(separator + 1);
  if (!clientId || clientId.length > 512) throw protocolError("invalid_client", "OAuth client authentication failed.");
  return { clientId, clientSecret };
}

export async function authenticateOAuthClient(request: Request, form: URLSearchParams): Promise<OAuthClientCredentials> {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const credentials = /^Basic\s+/i.test(authorization)
    ? decodeBasicCredentials(authorization)
    : {
        clientId: form.get("client_id")?.trim() ?? "",
        clientSecret: form.get("client_secret") ?? undefined,
      };
  if (!credentials.clientId || credentials.clientId.length > 512) throw protocolError("invalid_client", "OAuth client authentication failed.");
  const client = await getOAuthClientRecord(credentials.clientId);
  if (!client || !verifyOAuthClientSecret(client, credentials.clientSecret)) {
    throw protocolError("invalid_client", "OAuth client authentication failed.");
  }
  return credentials;
}

export function oauthErrorResponse(error: unknown): Response {
  const oauthError = error instanceof OAuthProtocolError
    ? error
    : new OAuthProtocolError("invalid_request", "The OAuth request could not be processed.");
  const status = oauthError.code === "invalid_client" ? 401 : 400;
  const response = NextResponse.json({ error: oauthError.code, error_description: oauthError.message }, { status });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Pragma", "no-cache");
  if (oauthError.code === "invalid_client") response.headers.set("WWW-Authenticate", 'Basic realm="Notes OAuth"');
  return response;
}

export function oauthSuccessResponse(body: Record<string, unknown>, status = 200): Response {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Pragma", "no-cache");
  return response;
}

export function oauthRateLimitResponse(retryAfter: number): Response {
  const response = NextResponse.json({ error: "slow_down", error_description: "Too many OAuth requests. Try again later." }, { status: 429 });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Retry-After", String(retryAfter));
  return response;
}

export async function formBody(request: Request): Promise<URLSearchParams> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") {
    throw protocolError("invalid_request", "OAuth requests must use application/x-www-form-urlencoded.");
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > 16 * 1024) throw protocolError("invalid_request", "The OAuth request is too large.");
  const body = await request.text();
  if (body.length > 16 * 1024) throw protocolError("invalid_request", "The OAuth request is too large.");
  return new URLSearchParams(body);
}
