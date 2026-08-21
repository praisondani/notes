import { mcpResourceUrl, exchangeAuthorizationCode, exchangeRefreshToken, OAuthProtocolError, parseOAuthScopeString } from "@/lib/mcp-oauth";
import { authenticateOAuthClient, consumeOAuthRateLimit, formBody, oauthErrorResponse, oauthRateLimitResponse, oauthSuccessResponse } from "@/lib/mcp-oauth-http";

function required(form: URLSearchParams, key: string): string {
  const value = form.get(key)?.trim() ?? "";
  if (!value) throw new OAuthProtocolError("invalid_request", `${key} is required.`);
  return value;
}

function tokenResponse(tokenSet: Awaited<ReturnType<typeof exchangeAuthorizationCode>>): Response {
  return oauthSuccessResponse({
    access_token: tokenSet.accessToken,
    token_type: "Bearer",
    expires_in: tokenSet.expiresIn,
    refresh_token: tokenSet.refreshToken,
    scope: tokenSet.scope.join(" "),
  });
}

export async function POST(request: Request): Promise<Response> {
  const rate = consumeOAuthRateLimit(request, "token", 120);
  if (!rate.allowed) return oauthRateLimitResponse(rate.retryAfter);
  try {
    const form = await formBody(request);
    const client = await authenticateOAuthClient(request, form);
    const grantType = required(form, "grant_type");
    const resource = form.get("resource")?.trim() || mcpResourceUrl(new URL(request.url).origin);
    if (grantType === "authorization_code") {
      const code = required(form, "code");
      const redirectUri = required(form, "redirect_uri");
      const codeVerifier = required(form, "code_verifier");
      return tokenResponse(await exchangeAuthorizationCode({ clientId: client.clientId, clientSecret: client.clientSecret, code, redirectUri, codeVerifier, resource }));
    }
    if (grantType === "refresh_token") {
      const refreshToken = required(form, "refresh_token");
      let scopes;
      try {
        scopes = parseOAuthScopeString(form.get("scope"));
      } catch {
        throw new OAuthProtocolError("invalid_scope", "The requested MCP scope is invalid.");
      }
      return tokenResponse(await exchangeRefreshToken({ clientId: client.clientId, clientSecret: client.clientSecret, refreshToken, scopes, resource }));
    }
    throw new OAuthProtocolError("unsupported_grant_type", "Only authorization_code and refresh_token are supported.");
  } catch (error) {
    return oauthErrorResponse(error);
  }
}
