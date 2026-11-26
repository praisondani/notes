import { NextResponse } from "next/server";
import { consumeLoginRateLimit, recordLoginFailure, clearLoginRateLimits } from "@/lib/auth-rate-limit";
import { loadAuthState, normalizeEmail, normalizeUsername, verifyPassword } from "@/lib/auth-store";
import { isAuthConfigurationReady, sameOriginRequest, setAuthenticatedCookie } from "@/lib/auth";
import { readJsonBody, RequestBodyError } from "@/lib/request-body";
import { clientAddress } from "@/lib/client-address";

export async function POST(request: Request) {
  if (!isAuthConfigurationReady()) return NextResponse.json({ error: "Authentication is not configured" }, { status: 503 });
  if (!sameOriginRequest(request)) return NextResponse.json({ error: "Request origin is not allowed" }, { status: 403 });
  let parsedBody: unknown;
  try {
    parsedBody = await readJsonBody(request, 8 * 1024);
  } catch (error) {
    const status = error instanceof RequestBodyError ? error.status : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request body" }, { status });
  }
  const body = parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody) ? parsedBody as { identifier?: unknown; password?: unknown } : {};
  const rawIdentifier = typeof body.identifier === "string" ? body.identifier.trim() : "";
  const identifier = rawIdentifier.length <= 254 ? rawIdentifier : "";
  const rawPassword = typeof body.password === "string" ? body.password : "";
  const passwordTooLong = rawPassword.length > 256;
  const password = passwordTooLong ? "" : rawPassword;
  const address = clientAddress(request);
  const addressKey = address ? `ip:${address}` : null;
  const credentialKey = addressKey ? `${addressKey}:${identifier.toLocaleLowerCase() || "unknown"}` : null;
  if (addressKey && credentialKey) {
    const addressRate = consumeLoginRateLimit(addressKey);
    const credentialRate = consumeLoginRateLimit(credentialKey);
    const blockedRate = [addressRate, credentialRate].find((rate) => !rate.allowed);
    if (blockedRate && !blockedRate.allowed) return NextResponse.json({ error: "Too many sign-in attempts. Try again later." }, { status: 429, headers: { "Retry-After": String(blockedRate.retryAfter) } });
  }

  const state = await loadAuthState();
  if (!state) return NextResponse.json({ error: "Account setup required", setupRequired: true }, { status: 409 });
  const normalized = identifier.includes("@") ? normalizeEmail(identifier) : normalizeUsername(identifier);
  const identifierMatches = normalized === state.user.username || normalized === state.user.email;
  const passwordMatches = await verifyPassword(password, state);
  if (!identifierMatches || !password || !passwordMatches) {
    if (addressKey && credentialKey) {
      recordLoginFailure(addressKey);
      recordLoginFailure(credentialKey);
    }
    return NextResponse.json({ error: "Invalid username, email, or password" }, { status: 401 });
  }

  if (addressKey && credentialKey) {
    clearLoginRateLimits(addressKey);
    clearLoginRateLimits(credentialKey);
  }
  await setAuthenticatedCookie(state);
  return NextResponse.json({ ok: true, user: state.user });
}
