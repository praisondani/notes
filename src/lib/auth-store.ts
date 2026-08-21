import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import path from "node:path";

const AUTH_FILE_NAME = "auth.json";
const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_SALT_LENGTH = 16;
const PASSWORD_MAX_LENGTH = 256;
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type AuthUser = {
  id: "owner";
  username: string;
  email: string;
  createdAt: string;
  updatedAt: string;
};

export type AuthState = {
  version: 1;
  user: AuthUser;
  passwordHash: string;
  passwordSalt: string;
  sessionVersion: number;
};

export type CredentialInput = {
  username: string;
  email: string;
  password: string;
};

function dataDirectory(): string {
  return path.resolve(process.env.DATA_DIR?.trim() || path.join(process.cwd(), "data"));
}

function authFilePath(): string {
  return path.join(dataDirectory(), AUTH_FILE_NAME);
}

export function normalizeUsername(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function normalizeEmail(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function validateCredentials(input: CredentialInput): string | CredentialInput {
  if (typeof input.username !== "string" || typeof input.email !== "string" || typeof input.password !== "string") return "Enter a valid username, email, and password.";
  const username = normalizeUsername(input.username);
  const email = normalizeEmail(input.email);
  const password = input.password;
  if (!USERNAME_PATTERN.test(username)) return "Username must be 3 to 32 characters using letters, numbers, dots, underscores, or hyphens.";
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) return "Enter a valid email address.";
  if (password.length < 12) return "Password must be at least 12 characters.";
  if (password.length > PASSWORD_MAX_LENGTH) return "Password must be 256 characters or fewer.";
  return { username, email, password };
}

function derivePassword(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, PASSWORD_KEY_LENGTH, { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key as Buffer);
    });
  });
}

export async function hashPassword(password: string, salt = randomBytes(PASSWORD_SALT_LENGTH)): Promise<{ passwordHash: string; passwordSalt: string }> {
  const derived = await derivePassword(password, salt);
  return { passwordHash: derived.toString("hex"), passwordSalt: salt.toString("hex") };
}

export async function verifyPassword(password: string, state: Pick<AuthState, "passwordHash" | "passwordSalt">): Promise<boolean> {
  try {
    const salt = Buffer.from(state.passwordSalt, "hex");
    const expected = Buffer.from(state.passwordHash, "hex");
    if (salt.length !== PASSWORD_SALT_LENGTH || expected.length !== PASSWORD_KEY_LENGTH) return false;
    const actual = await derivePassword(password, salt);
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function validAuthState(value: unknown): value is AuthState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<AuthState>;
  const user = state.user as Partial<AuthUser> | undefined;
  return state.version === 1
    && user?.id === "owner"
    && typeof user.username === "string"
    && USERNAME_PATTERN.test(user.username)
    && typeof user.email === "string"
    && typeof user.createdAt === "string"
    && typeof user.updatedAt === "string"
    && typeof state.passwordHash === "string"
    && /^[a-f0-9]{128}$/.test(state.passwordHash)
    && typeof state.passwordSalt === "string"
    && /^[a-f0-9]{32}$/.test(state.passwordSalt)
    && typeof state.sessionVersion === "number"
    && Number.isSafeInteger(state.sessionVersion)
    && state.sessionVersion >= 1;
}

export async function saveAuthState(state: AuthState): Promise<void> {
  const directory = dataDirectory();
  const filename = authFilePath();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, filename);
  await chmod(filename, 0o600);
}

export async function createAuthState(input: CredentialInput, now = new Date()): Promise<AuthState> {
  const validated = validateCredentials(input);
  if (typeof validated === "string") throw new Error(validated);
  const timestamp = now.toISOString();
  return {
    version: 1,
    user: { id: "owner", username: validated.username, email: validated.email, createdAt: timestamp, updatedAt: timestamp },
    ...(await hashPassword(validated.password)),
    sessionVersion: 1,
  };
}

export async function loadAuthState(): Promise<AuthState | null> {
  try {
    const parsed = JSON.parse(await readFile(authFilePath(), "utf8")) as unknown;
    if (!validAuthState(parsed)) throw new Error("Invalid Notes auth store");
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const legacyPassword = process.env.AUTH_PASSWORD ?? "";
  if (!legacyPassword) return null;
  const username = process.env.AUTH_USERNAME?.trim() || "admin";
  const email = process.env.AUTH_EMAIL?.trim() || "owner@notes.local";
  const state = await createAuthState({ username, email, password: legacyPassword });
  await saveAuthState(state);
  return state;
}

export function publicUser(user: AuthUser): AuthUser {
  return { ...user };
}
