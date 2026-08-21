import { parseOAuthScopeString, registerOAuthClient, OAuthProtocolError, type OAuthTokenEndpointAuthMethod } from "@/lib/mcp-oauth";
import { consumeOAuthRateLimit, oauthErrorResponse, oauthRateLimitResponse, oauthSuccessResponse } from "@/lib/mcp-oauth-http";

function requestedAuthMethod(value: unknown): OAuthTokenEndpointAuthMethod | undefined {
  if (value === undefined) return undefined;
  if (value === "none" || value === "client_secret_post" || value === "client_secret_basic") return value;
  throw new OAuthProtocolError("invalid_request", "Unsupported token endpoint authentication method.");
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new OAuthProtocolError("invalid_request", "redirect_uris must be an array of strings.");
  }
  return value;
}

export async function POST(request: Request): Promise<Response> {
  const rate = consumeOAuthRateLimit(request, "registration", 10);
  if (!rate.allowed) return oauthRateLimitResponse(rate.retryAfter);

  try {
    const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "application/json") throw new OAuthProtocolError("invalid_request", "Dynamic client registration requires application/json.");
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (contentLength > 64 * 1024) throw new OAuthProtocolError("invalid_request", "The registration payload is too large.");
    const body = await request.json().catch(() => { throw new OAuthProtocolError("invalid_request", "The registration payload is invalid."); }) as Record<string, unknown>;
    let scopes;
    try {
      scopes = typeof body.scope === "string" ? parseOAuthScopeString(body.scope) : undefined;
    } catch {
      throw new OAuthProtocolError("invalid_scope", "The requested MCP scope is invalid.");
    }
    const registration = await registerOAuthClient({
      clientName: typeof body.client_name === "string" ? body.client_name : undefined,
      clientUri: typeof body.client_uri === "string" ? body.client_uri : undefined,
      redirectUris: stringArray(body.redirect_uris),
      tokenEndpointAuthMethod: requestedAuthMethod(body.token_endpoint_auth_method),
      scopes,
    });
    const bodyResponse: Record<string, unknown> = {
      client_id: registration.client.clientId,
      client_id_issued_at: Math.floor(new Date(registration.client.createdAt).getTime() / 1_000),
      redirect_uris: registration.client.redirectUris,
      client_name: registration.client.clientName,
      token_endpoint_auth_method: registration.client.tokenEndpointAuthMethod,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    };
    if (registration.client.clientUri) bodyResponse.client_uri = registration.client.clientUri;
    if (registration.client.scopes?.length) bodyResponse.scope = registration.client.scopes.join(" ");
    if (registration.clientSecret) bodyResponse.client_secret = registration.clientSecret;
    return oauthSuccessResponse(bodyResponse, 201);
  } catch (error) {
    return oauthErrorResponse(error);
  }
}
