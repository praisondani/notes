import { afterEach, describe, expect, it } from "vitest";
import { consumeOAuthRateLimit } from "@/lib/mcp-oauth-http";

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe("OAuth rate limit client identity", () => {
  it("does not let untrusted forwarding headers split the default rate bucket", () => {
    delete process.env.TRUST_PROXY_HEADERS;
    const first = new Request("http://localhost/oauth/token", { headers: { "X-Forwarded-For": "198.51.100.10" } });
    const second = new Request("http://localhost/oauth/token", { headers: { "X-Real-IP": "203.0.113.20" } });
    const bucket = `untrusted-proxy-${crypto.randomUUID()}`;

    expect(consumeOAuthRateLimit(first, bucket, 1, 0)).toEqual({ allowed: true });
    expect(consumeOAuthRateLimit(second, bucket, 1, 0)).toEqual({ allowed: false, retryAfter: 60 });
  });

  it("uses proxy addresses only after explicit trust is configured", () => {
    process.env.TRUST_PROXY_HEADERS = "1";
    const first = new Request("http://localhost/oauth/token", { headers: { "X-Forwarded-For": "198.51.100.10" } });
    const second = new Request("http://localhost/oauth/token", { headers: { "X-Real-IP": "203.0.113.20" } });
    const bucket = `trusted-proxy-${crypto.randomUUID()}`;

    expect(consumeOAuthRateLimit(first, bucket, 1, 0)).toEqual({ allowed: true });
    expect(consumeOAuthRateLimit(second, bucket, 1, 0)).toEqual({ allowed: true });
  });
});
