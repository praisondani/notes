import { afterEach, describe, expect, it } from "vitest";
import { clientAddress } from "@/lib/client-address";

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe("client address trust", () => {
  it("ignores forwarding headers unless the trusted proxy flag is enabled", () => {
    delete process.env.TRUST_PROXY_HEADERS;
    const first = new Request("http://localhost", { headers: { "X-Forwarded-For": "198.51.100.10" } });
    const second = new Request("http://localhost", { headers: { "X-Real-IP": "203.0.113.20" } });
    expect(clientAddress(first)).toBeNull();
    expect(clientAddress(second)).toBeNull();

    process.env.TRUST_PROXY_HEADERS = "1";
    expect(clientAddress(first)).toBe("198.51.100.10");
    expect(clientAddress(second)).toBe("203.0.113.20");
    expect(clientAddress(new Request("http://localhost"))).toBeNull();
  });
});
