import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAuthState, loadAuthState, saveAuthState, validateCredentials, verifyPassword } from "@/lib/auth-store";

let dataDirectory = "";
const originalEnvironment = { ...process.env };

beforeEach(async () => {
  dataDirectory = await mkdtemp(path.join(os.tmpdir(), "notes-auth-store-"));
  process.env.DATA_DIR = dataDirectory;
  delete process.env.AUTH_PASSWORD;
  delete process.env.AUTH_USERNAME;
  delete process.env.AUTH_EMAIL;
});

afterEach(async () => {
  process.env = { ...originalEnvironment };
  await rm(dataDirectory, { recursive: true, force: true });
});

describe("auth store", () => {
  it("validates account fields and normalizes identifiers", () => {
    expect(validateCredentials({ username: "Case_User", email: "Case@Example.com", password: "correct horse battery staple" })).toEqual({
      username: "case_user",
      email: "case@example.com",
      password: "correct horse battery staple",
    });
    expect(validateCredentials({ username: "ab", email: "case@example.com", password: "correct horse battery staple" })).toBe("Username must be 3 to 32 characters using letters, numbers, dots, underscores, or hyphens.");
    expect(validateCredentials({ username: "case", email: "not-an-email", password: "correct horse battery staple" })).toBe("Enter a valid email address.");
    expect(validateCredentials({ username: "case", email: "case@example.com", password: "short" })).toBe("Password must be at least 12 characters.");
  });

  it("stores only a salted password hash and verifies it", async () => {
    const state = await createAuthState({ username: "case", email: "case@example.com", password: "correct horse battery staple" });

    expect(state.passwordHash).not.toContain("correct horse");
    expect(state.passwordSalt).not.toBe("");
    expect(await verifyPassword("correct horse battery staple", state)).toBe(true);
    expect(await verifyPassword("wrong password", state)).toBe(false);
  });

  it("round-trips the owner account and migrates the legacy password setting", async () => {
    process.env.AUTH_PASSWORD = "legacy-password-that-is-long";
    process.env.AUTH_USERNAME = "legacy-owner";
    process.env.AUTH_EMAIL = "legacy-owner@notes.test";

    const migrated = await loadAuthState();
    expect(migrated?.user.username).toBe("legacy-owner");
    expect(await verifyPassword("legacy-password-that-is-long", migrated!)).toBe(true);

    await saveAuthState({ ...migrated!, sessionVersion: migrated!.sessionVersion + 1 });
    const loaded = await loadAuthState();
    expect(loaded?.sessionVersion).toBe(2);
  });
});
