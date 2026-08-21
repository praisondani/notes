import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const SESSION_COOKIE = "notes_session";

function configuredPassword(): string {
  return process.env.AUTH_PASSWORD?.trim() ?? "";
}

function sessionToken(): string {
  const secret = process.env.AUTH_SECRET?.trim() || "notes-development-secret";
  return createHmac("sha256", secret).update(`authenticated:${configuredPassword()}`).digest("hex");
}

export function authEnabled(): boolean {
  return configuredPassword().length > 0;
}

export async function isAuthenticated(): Promise<boolean> {
  if (!authEnabled()) return true;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return false;
  const expected = Buffer.from(sessionToken(), "utf8");
  const actual = Buffer.from(token, "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function setAuthenticatedCookie(): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, sessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
}

export async function clearAuthenticatedCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

export function checkPassword(password: string): boolean {
  const expected = Buffer.from(configuredPassword(), "utf8");
  const actual = Buffer.from(password, "utf8");
  return expected.length > 0 && expected.length === actual.length && timingSafeEqual(expected, actual);
}
