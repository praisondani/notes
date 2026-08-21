import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { authenticatedUser, getAuthStatus, sameOriginRequest } from "@/lib/auth";
import {
  approveAuthorizationRequest,
  beginAuthorizationRequest,
  createOAuthBrowserSecret,
  getAuthorizationRequest,
  mcpResourceUrl,
  OAUTH_BROWSER_COOKIE,
  OAuthProtocolError,
  parseOAuthScopeString,
} from "@/lib/mcp-oauth";
import { consumeOAuthRateLimit, oauthErrorResponse, oauthRateLimitResponse } from "@/lib/mcp-oauth-http";

const browserCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: 10 * 60,
  path: "/api/oauth",
};

function required(searchParams: URLSearchParams, key: string): string {
  const value = searchParams.get(key)?.trim() ?? "";
  if (!value) throw new OAuthProtocolError("invalid_request", `${key} is required.`);
  return value;
}

function consentPayload(request: Awaited<ReturnType<typeof getAuthorizationRequest>>, auth: Awaited<ReturnType<typeof getAuthStatus>>): Record<string, unknown> {
  if (!request) throw new OAuthProtocolError("invalid_request", "The authorization request is invalid or expired.");
  return {
    authenticated: auth.authenticated,
    setupRequired: auth.setupRequired,
    transaction: request.transactionId,
    client: { name: request.clientName, ...(request.clientUri ? { uri: request.clientUri } : {}) },
    redirectUri: request.redirectUri,
    scopes: request.scopes,
    expiresAt: request.expiresAt,
  };
}

export async function GET(request: Request): Promise<Response> {
  const rate = consumeOAuthRateLimit(request, "authorize", 60);
  if (!rate.allowed) return oauthRateLimitResponse(rate.retryAfter);
  try {
    const searchParams = new URL(request.url).searchParams;
    const cookieStore = await cookies();
    const browserSecret = cookieStore.get(OAUTH_BROWSER_COOKIE)?.value;
    const existingTransaction = searchParams.get("transaction")?.trim();
    let transactionId = existingTransaction;

    if (!transactionId) {
      const responseType = required(searchParams, "response_type");
      if (responseType !== "code") throw new OAuthProtocolError("unsupported_response_type", "Only response_type=code is supported.");
      const codeChallengeMethod = searchParams.get("code_challenge_method")?.trim() ?? "";
      if (codeChallengeMethod !== "S256") throw new OAuthProtocolError("invalid_request", "PKCE with code_challenge_method=S256 is required.");
      const clientId = required(searchParams, "client_id");
      const redirectUri = required(searchParams, "redirect_uri");
      const codeChallenge = required(searchParams, "code_challenge");
      const secret = createOAuthBrowserSecret();
      const pending = await beginAuthorizationRequest({
        clientId,
        redirectUri,
        state: searchParams.get("state") ?? undefined,
        codeChallenge,
        scopes: parseOAuthScopeString(searchParams.get("scope")),
        resource: searchParams.get("resource")?.trim() || mcpResourceUrl(new URL(request.url).origin),
      }, secret);
      transactionId = pending.transactionId;
      const auth = await getAuthStatus();
      const authorization = await getAuthorizationRequest(transactionId, secret);
      const response = NextResponse.json(consentPayload(authorization, auth));
      response.cookies.set(OAUTH_BROWSER_COOKIE, secret, browserCookieOptions);
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }

    if (!browserSecret) throw new OAuthProtocolError("invalid_request", "The authorization browser session is missing or expired.");
    const authorization = await getAuthorizationRequest(transactionId, browserSecret);
    const auth = await getAuthStatus();
    const response = NextResponse.json(consentPayload(authorization, auth));
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    return oauthErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!sameOriginRequest(request)) return NextResponse.json({ error: "Request origin is not allowed" }, { status: 403 });
  const rate = consumeOAuthRateLimit(request, "authorize-decision", 60);
  if (!rate.allowed) return oauthRateLimitResponse(rate.retryAfter);
  try {
    const form = await request.formData();
    const transactionId = typeof form.get("transaction") === "string" ? String(form.get("transaction")).trim() : "";
    const decision = typeof form.get("decision") === "string" ? String(form.get("decision")).trim() : "";
    if (!transactionId || (decision !== "approve" && decision !== "deny")) throw new OAuthProtocolError("invalid_request", "The authorization decision is invalid.");
    const browserSecret = (await cookies()).get(OAUTH_BROWSER_COOKIE)?.value;
    if (!browserSecret) throw new OAuthProtocolError("invalid_request", "The authorization browser session is missing or expired.");
    const pending = await getAuthorizationRequest(transactionId, browserSecret);
    if (!pending) throw new OAuthProtocolError("invalid_request", "The authorization request is invalid or expired.");
    const user = await authenticatedUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    const completion = await approveAuthorizationRequest(transactionId, browserSecret, user.id, decision === "approve");
    const redirect = new URL(completion.redirectUri);
    if (completion.code) redirect.searchParams.set("code", completion.code);
    if (completion.error) redirect.searchParams.set("error", completion.error);
    if (completion.state) redirect.searchParams.set("state", completion.state);
    const response = NextResponse.redirect(redirect, 303);
    response.cookies.set(OAUTH_BROWSER_COOKIE, "", { ...browserCookieOptions, maxAge: 0 });
    return response;
  } catch (error) {
    return oauthErrorResponse(error);
  }
}
