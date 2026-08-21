import { revokeOAuthToken, OAuthProtocolError } from "@/lib/mcp-oauth";
import { authenticateOAuthClient, consumeOAuthRateLimit, formBody, oauthErrorResponse, oauthRateLimitResponse, oauthSuccessResponse } from "@/lib/mcp-oauth-http";

export async function POST(request: Request): Promise<Response> {
  const rate = consumeOAuthRateLimit(request, "revoke", 60);
  if (!rate.allowed) return oauthRateLimitResponse(rate.retryAfter);
  try {
    const form = await formBody(request);
    await authenticateOAuthClient(request, form);
    const token = form.get("token")?.trim() ?? "";
    if (!token) throw new OAuthProtocolError("invalid_request", "token is required.");
    await revokeOAuthToken(token);
    return oauthSuccessResponse({}, 200);
  } catch (error) {
    return oauthErrorResponse(error);
  }
}
