import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { createAuthState, loadAuthState, normalizeEmail, normalizeUsername, publicUser, saveAuthState, validateCredentials, verifyPassword, type AuthState, type AuthUser, type CredentialInput } from "@/lib/auth-store";

const SESSION_COOKIE = "notes_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export type AuthStatus = {
  setupRequired: boolean;
  authenticated: boolean;
  user?: AuthUser;
};

function authSecret(): string {
  const configured = process.env.AUTH_SECRET?.trim();
  if (configured && configured !== "replace-with-a-long-random-string") return configured;
  if (process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET must be configured with a long random value");
  return "notes-development-secret";
}

function signSession(payload: string): string {
  return createHmac("sha256", authSecret()).update(payload).digest("hex");
}

function createSessionToken(state: AuthState, now = Date.now()): string {
  const expiresAt = Math.floor(now / 1_000) + SESSION_MAX_AGE_SECONDS;
  const payload = [state.user.id, state.sessionVersion, expiresAt, randomBytes(18).toString("base64url")].join(".");
  return `${payload}.${signSession(payload)}`;
}

function signaturesMatch(left: string, right: string): boolean {
  const actual = Buffer.from(left, "hex");
  const expected = Buffer.from(right, "hex");
  return actual.length === expected.length && actual.length > 0 && timingSafeEqual(actual, expected);
}

function sessionMatches(token: string | undefined, state: AuthState, now = Date.now()): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 5) return false;
  const [userId, version, expiresAt, nonce, signature] = parts;
  if (userId !== state.user.id || version !== String(state.sessionVersion) || !nonce || !/^\d+$/.test(expiresAt)) return false;
  if (Number(expiresAt) <= Math.floor(now / 1_000)) return false;
  return signaturesMatch(signature, signSession([userId, version, expiresAt, nonce].join(".")));
}

async function currentStateAndUser(): Promise<{ state: AuthState; user: AuthUser } | null> {
  const state = await loadAuthState();
  if (!state || !sessionMatches((await cookies()).get(SESSION_COOKIE)?.value, state)) return null;
  return { state, user: state.user };
}

export async function getAuthStatus(): Promise<AuthStatus> {
  const state = await loadAuthState();
  if (!state) return { setupRequired: true, authenticated: false };
  const authenticated = sessionMatches((await cookies()).get(SESSION_COOKIE)?.value, state);
  return authenticated ? { setupRequired: false, authenticated: true, user: publicUser(state.user) } : { setupRequired: false, authenticated: false };
}

export async function isAuthenticated(): Promise<boolean> {
  return Boolean(await currentStateAndUser());
}

export async function authenticatedUser(): Promise<AuthUser | null> {
  return (await currentStateAndUser())?.user ?? null;
}

export async function setAuthenticatedCookie(state?: AuthState): Promise<void> {
  const nextState = state ?? await loadAuthState();
  if (!nextState) throw new Error("Auth account is not configured");
  (await cookies()).set(SESSION_COOKIE, createSessionToken(nextState), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
  });
}

export async function clearAuthenticatedCookie(): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 0, path: "/" });
}

export function sameOriginRequest(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin")?.trim();
  if (!origin) return true;

  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || new URL(request.url).protocol.replace(":", "");
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host")?.trim() || new URL(request.url).host;
  const requestOrigin = `${forwardedProto}://${forwardedHost}`;
  const configuredOrigin = (() => {
    try {
      return process.env.APP_URL?.trim() ? new URL(process.env.APP_URL.trim()).origin : "";
    } catch {
      return "";
    }
  })();
  return origin === requestOrigin || (configuredOrigin.length > 0 && origin === configuredOrigin);
}

let queuedMutation: Promise<unknown> = Promise.resolve();

function withAuthMutation<T>(operation: () => Promise<T>): Promise<T> {
  const next = queuedMutation.then(operation);
  queuedMutation = next.then(() => undefined, () => undefined);
  return next;
}

export async function setupAccount(input: CredentialInput): Promise<AuthUser> {
  return withAuthMutation(async () => {
    if (await loadAuthState()) throw new Error("Auth account already exists");
    const state = await createAuthState(input);
    await saveAuthState(state);
    await setAuthenticatedCookie(state);
    return publicUser(state.user);
  });
}

export async function updateAccountProfile(input: { username: string; email: string }): Promise<AuthUser> {
  const current = await currentStateAndUser();
  if (!current) throw new Error("Authentication required");
  const username = normalizeUsername(input.username);
  const email = normalizeEmail(input.email);
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) throw new Error("Username must be 3 to 32 characters using letters, numbers, dots, underscores, or hyphens.");
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
  return withAuthMutation(async () => {
    const state = await loadAuthState();
    if (!state) throw new Error("Auth account is not configured");
    const updatedAt = new Date().toISOString();
    const next = { ...state, user: { ...state.user, username, email, updatedAt } };
    await saveAuthState(next);
    return publicUser(next.user);
  });
}

export async function changeAccountPassword(currentPassword: string, nextPassword: string): Promise<void> {
  const current = await currentStateAndUser();
  if (!current) throw new Error("Authentication required");
  const validation = validateCredentials({ username: current.user.username, email: current.user.email, password: nextPassword });
  if (typeof validation === "string") throw new Error(validation);
  if (!(await verifyPassword(currentPassword, current.state))) throw new Error("Current password is incorrect.");
  return withAuthMutation(async () => {
    const state = await loadAuthState();
    if (!state || !(await verifyPassword(currentPassword, state))) throw new Error("Current password is incorrect.");
    const nextCredentials = await createAuthState({ username: state.user.username, email: state.user.email, password: nextPassword });
    const nextState = { ...nextCredentials, user: state.user, sessionVersion: state.sessionVersion + 1 };
    await saveAuthState(nextState);
    await setAuthenticatedCookie(nextState);
  });
}
