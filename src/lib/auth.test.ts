import { afterEach, describe, expect, it } from "vitest";
import { isAuthConfigurationReady } from "@/lib/auth";

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe("production auth configuration", () => {
  it("requires a non-placeholder secret with at least 32 bytes in production", () => {
    process.env.NODE_ENV = "production";
    delete process.env.AUTH_SECRET;
    expect(isAuthConfigurationReady()).toBe(false);
    process.env.AUTH_SECRET = "replace-with-a-long-random-string";
    expect(isAuthConfigurationReady()).toBe(false);
    process.env.AUTH_SECRET = "too-short";
    expect(isAuthConfigurationReady()).toBe(false);
    process.env.AUTH_SECRET = "a-realistic-long-secret-for-testing-1234";
    expect(isAuthConfigurationReady()).toBe(true);
  });
});
