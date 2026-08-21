import { NextResponse } from "next/server";
import { consumeLoginRateLimit, recordLoginFailure, clearLoginRateLimits } from "@/lib/auth-rate-limit";
import { loadAuthState, normalizeEmail, normalizeUsername, verifyPassword } from "@/lib/auth-store";
import { sameOriginRequest, setAuthenticatedCookie } from "@/lib/auth";

function clientAddress(request: Request): string {
  return request.headers.get("x-real-ip")?.trim() || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function POST(request: Request) {
  if (!sameOriginRequest(request)) return NextResponse.json({ error: "Request origin is not allowed" }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { identifier?: string; password?: string };
  const rawIdentifier = typeof body.identifier === "string" ? body.identifier.trim() : "";
  const identifier = rawIdentifier.length <= 254 ? rawIdentifier : "";
  const rawPassword = typeof body.password === "string" ? body.password : "";
  const passwordTooLong = rawPassword.length > 256;
  const password = passwordTooLong ? "" : rawPassword;
  const addressKey = `ip:${clientAddress(request)}`;
  const credentialKey = `${addressKey}:${identifier.toLocaleLowerCase() || "unknown"}`;
  const addressRate = consumeLoginRateLimit(addressKey);
  const credentialRate = consumeLoginRateLimit(credentialKey);
  const blockedRate = [addressRate, credentialRate].find((rate) => !rate.allowed);
  if (blockedRate && !blockedRate.allowed) return NextResponse.json({ error: "Too many sign-in attempts. Try again later." }, { status: 429, headers: { "Retry-After": String(blockedRate.retryAfter) } });

  const state = await loadAuthState();
  if (!state) return NextResponse.json({ error: "Account setup required", setupRequired: true }, { status: 409 });
  const normalized = identifier.includes("@") ? normalizeEmail(identifier) : normalizeUsername(identifier);
  const identifierMatches = normalized === state.user.username || normalized === state.user.email;
  const passwordMatches = await verifyPassword(password, state);
  if (!identifierMatches || !password || !passwordMatches) {
    recordLoginFailure(addressKey);
    recordLoginFailure(credentialKey);
    return NextResponse.json({ error: "Invalid username, email, or password" }, { status: 401 });
  }

  clearLoginRateLimits(addressKey);
  clearLoginRateLimits(credentialKey);
  await setAuthenticatedCookie(state);
  return NextResponse.json({ ok: true, user: state.user });
}
