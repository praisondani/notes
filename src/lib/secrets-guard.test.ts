import { describe, expect, it } from "vitest";
import { detectSecret } from "@/lib/secrets-guard";

describe("secrets guard", () => {
  it.each([
    ["sk-test-abcdefghijklmnopqrstuvwxyz012345", "API key"],
    ["ghp_abcdefghijklmnopqrstuvwxyz0123456789", "API key"],
    ["xoxb-123456789012-123456789012-abcdefghijklmnopqrstuvwx", "API key"],
    ["AKIAIOSFODNN7EXAMPLE", "API key"],
    ["AIzaSyA-abcdefghijklmnopqrstuvwxyz0123", "API key"],
    ["-----BEGIN PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF4P\n-----END PRIVATE KEY-----", "private key"],
    ["eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature", "JWT"],
    ["password: hunter2-secret", "password"],
    ["verification code 482193", "code"],
    ["4111111111111111", "card"],
  ])("rejects %s", (value) => {
    const result = detectSecret(value);
    expect(result.blocked).toBe(true);
    expect(result.message).toContain("Looks like a secret");
  });

  it("allows ordinary statements", () => {
    expect(detectSecret("George prefers America/Chicago for scheduling.").blocked).toBe(false);
  });
});
