import { describe, expect, it } from "vitest";
import {
  createSafeLookup,
  isBlockedAddress,
  isLoopbackAddress,
  SsrfError,
  validateEndpointUrl,
} from "@/lib/security/ssrf";
import { checkRateLimit, resetRateLimitsForTests } from "@/lib/security/rate-limit";

const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];
const privateResolver = async () => [{ address: "10.0.0.5", family: 4 }];
const loopbackResolver = async () => [{ address: "127.0.0.1", family: 4 }];
const mixedResolver = async () => [
  { address: "93.184.216.34", family: 4 },
  { address: "10.0.0.5", family: 4 },
];

describe("SSRF address classification", () => {
  it("blocks private, loopback, link-local, and reserved addresses", () => {
    for (const address of [
      "0.0.0.0",
      "10.1.2.3",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.8.9",
      "192.168.1.1",
      "198.18.0.1",
      "224.0.0.1",
      "255.255.255.255",
      "::1",
      "fc00::1",
      "fe80::1",
      "ff02::1",
      "::ffff:10.0.0.5",
    ]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it("allows public addresses", () => {
    expect(isBlockedAddress("93.184.216.34")).toBe(false);
    expect(isBlockedAddress("2606:4700:4700::1111")).toBe(false);
  });

  it("detects loopback addresses", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("10.0.0.1")).toBe(false);
  });
});

describe("validateEndpointUrl", () => {
  it("accepts a public HTTPS endpoint", async () => {
    const result = await validateEndpointUrl("https://api.example.com/v1", {
      resolver: publicResolver,
    });
    expect(result.url.hostname).toBe("api.example.com");
    expect(result.addresses).toHaveLength(1);
  });

  it("rejects plain HTTP unless localhost is explicitly allowed", async () => {
    await expect(
      validateEndpointUrl("http://api.example.com/v1", { resolver: publicResolver }),
    ).rejects.toBeInstanceOf(SsrfError);

    await expect(
      validateEndpointUrl("http://localhost:1234/v1", {
        allowLoopback: true,
        resolver: loopbackResolver,
      }),
    ).resolves.toBeDefined();
  });

  it("rejects embedded credentials", async () => {
    await expect(
      validateEndpointUrl("https://user:pass@api.example.com/v1", {
        resolver: publicResolver,
      }),
    ).rejects.toThrow(/credentials/i);
  });

  it("rejects non-HTTPS protocols", async () => {
    await expect(
      validateEndpointUrl("ftp://api.example.com/v1", { resolver: publicResolver }),
    ).rejects.toThrow(/HTTPS/i);
  });

  it("rejects private resolutions", async () => {
    await expect(
      validateEndpointUrl("https://private.example.com/v1", { resolver: privateResolver }),
    ).rejects.toThrow(/private, loopback/i);
  });

  it("rejects loopback resolutions by default", async () => {
    await expect(
      validateEndpointUrl("https://localhost/v1", { resolver: loopbackResolver }),
    ).rejects.toThrow(/localhost/i);
  });

  it("rejects a hostname that resolves to any private address", async () => {
    await expect(
      validateEndpointUrl("https://mixed.example.com/v1", { resolver: mixedResolver }),
    ).rejects.toThrow(/private, loopback/i);
  });

  it("rejects literal private IP addresses without DNS", async () => {
    await expect(validateEndpointUrl("https://10.0.0.5/v1")).rejects.toThrow(/private, loopback/i);
    await expect(validateEndpointUrl("https://169.254.169.254/latest")).rejects.toThrow(
      /private, loopback/i,
    );
  });

  it("rejects non-standard HTTPS ports", async () => {
    await expect(
      validateEndpointUrl("https://api.example.com:8443/v1", { resolver: publicResolver }),
    ).rejects.toThrow(/port 443/i);
  });

  it("rejects unresolvable hosts", async () => {
    await expect(
      validateEndpointUrl("https://missing.example.com/v1", {
        resolver: async () => {
          throw new Error("ENOTFOUND");
        },
      }),
    ).rejects.toThrow(/could not be resolved/i);
  });

  it("rejects empty resolution results", async () => {
    await expect(
      validateEndpointUrl("https://empty.example.com/v1", { resolver: async () => [] }),
    ).rejects.toThrow(/did not resolve/i);
  });
});

describe("safe connect lookup", () => {
  function runLookup(
    lookup: ReturnType<typeof createSafeLookup>,
    all: boolean,
  ): Promise<{
    error: Error | null;
    address?: string | Array<{ address: string; family: number }>;
    family?: number;
  }> {
    return new Promise((resolve) => {
      lookup("api.example.com", { all }, (error, address, family) => {
        resolve({ error, address, family });
      });
    });
  }

  it("returns the address array when autoSelectFamily requests all results", async () => {
    const lookup = createSafeLookup(false, publicResolver);
    const result = await runLookup(lookup, true);
    expect(result.error).toBeNull();
    expect(result.address).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });

  it("returns a single address when all results are not requested", async () => {
    const lookup = createSafeLookup(false, publicResolver);
    const result = await runLookup(lookup, false);
    expect(result.error).toBeNull();
    expect(result.address).toBe("93.184.216.34");
    expect(result.family).toBe(4);
  });

  it("rejects a connection that resolves only to private addresses", async () => {
    const lookup = createSafeLookup(false, privateResolver);
    const result = await runLookup(lookup, true);
    expect(result.error).toBeInstanceOf(SsrfError);
    expect(result.address).toBeUndefined();
  });

  it("keeps only public addresses in the all-results response", async () => {
    const lookup = createSafeLookup(false, mixedResolver);
    const result = await runLookup(lookup, true);
    expect(result.error).toBeNull();
    expect(result.address).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });

  it("allows loopback only when explicitly enabled", async () => {
    const lookup = createSafeLookup(true, loopbackResolver);
    const result = await runLookup(lookup, true);
    expect(result.error).toBeNull();
    expect(result.address).toEqual([{ address: "127.0.0.1", family: 4 }]);
  });
});

describe("rate limit", () => {
  it("allows up to the limit and then reports a retry window", () => {
    resetRateLimitsForTests();
    const now = 1_000_000;
    expect(checkRateLimit("user", 2, 60_000, now).allowed).toBe(true);
    expect(checkRateLimit("user", 2, 60_000, now + 1).allowed).toBe(true);
    const blocked = checkRateLimit("user", 2, 60_000, now + 2);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("expires old timestamps", () => {
    resetRateLimitsForTests();
    const now = 2_000_000;
    expect(checkRateLimit("user", 1, 1_000, now).allowed).toBe(true);
    expect(checkRateLimit("user", 1, 1_000, now + 500).allowed).toBe(false);
    expect(checkRateLimit("user", 1, 1_000, now + 1_001).allowed).toBe(true);
  });

  it("scopes buckets by key", () => {
    resetRateLimitsForTests();
    expect(checkRateLimit("a", 1).allowed).toBe(true);
    expect(checkRateLimit("b", 1).allowed).toBe(true);
    expect(checkRateLimit("a", 1).allowed).toBe(false);
  });
});
