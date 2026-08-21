import { afterEach, describe, expect, it } from "vitest";
import { clearLoginRateLimits, consumeLoginRateLimit, recordLoginFailure } from "@/lib/auth-rate-limit";

afterEach(() => clearLoginRateLimits());

describe("auth rate limiting", () => {
  it("allows normal attempts and blocks repeated failures for a bounded window", () => {
    const key = "127.0.0.1:case";
    expect(consumeLoginRateLimit(key, 0)).toEqual({ allowed: true });
    for (let index = 0; index < 5; index += 1) recordLoginFailure(key, 0);
    expect(consumeLoginRateLimit(key, 1)).toEqual({ allowed: false, retryAfter: 900 });
  });

  it("clears a successful identifier's failures", () => {
    const key = "127.0.0.1:case";
    recordLoginFailure(key, 0);
    clearLoginRateLimits(key);
    expect(consumeLoginRateLimit(key, 1)).toEqual({ allowed: true });
  });
});
