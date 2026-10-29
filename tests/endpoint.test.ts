import { afterEach, describe, expect, it } from "vitest";
import { validateCustomBaseUrl } from "@/lib/security/endpoint";

const originalAllowLocal = process.env.ALLOW_INSECURE_LOCAL_ENDPOINTS;

afterEach(() => {
  process.env.ALLOW_INSECURE_LOCAL_ENDPOINTS = originalAllowLocal;
});

describe("custom endpoint validation", () => {
  it("normalizes a public HTTPS base URL", async () => {
    process.env.ALLOW_INSECURE_LOCAL_ENDPOINTS = "false";
    await expect(validateCustomBaseUrl("https://93.184.216.34/v1/chat/completions")).resolves.toBe(
      "https://93.184.216.34/v1",
    );
  });

  it("rejects invalid and non-absolute URLs", async () => {
    await expect(validateCustomBaseUrl("not a url")).rejects.toMatchObject({
      code: "invalid_endpoint",
    });
    await expect(validateCustomBaseUrl("/relative/path")).rejects.toMatchObject({
      code: "invalid_endpoint",
    });
  });

  it("rejects query strings and fragments", async () => {
    await expect(validateCustomBaseUrl("https://93.184.216.34/v1?key=1")).rejects.toMatchObject({
      code: "invalid_endpoint",
    });
    await expect(validateCustomBaseUrl("https://93.184.216.34/v1#fragment")).rejects.toMatchObject({
      code: "invalid_endpoint",
    });
  });

  it("rejects private and link-local literal addresses", async () => {
    await expect(validateCustomBaseUrl("https://10.0.0.1/v1")).rejects.toMatchObject({
      code: "unsafe_endpoint",
    });
    await expect(validateCustomBaseUrl("https://169.254.169.254/latest")).rejects.toMatchObject({
      code: "unsafe_endpoint",
    });
    await expect(validateCustomBaseUrl("https://127.0.0.1/v1")).rejects.toMatchObject({
      code: "unsafe_endpoint",
    });
  });

  it("rejects plain HTTP even when local endpoints are allowed for public hosts", async () => {
    process.env.ALLOW_INSECURE_LOCAL_ENDPOINTS = "true";
    await expect(validateCustomBaseUrl("http://93.184.216.34/v1")).rejects.toMatchObject({
      code: "unsafe_endpoint",
    });
  });

  it("rejects non-HTTPS schemes", async () => {
    await expect(validateCustomBaseUrl("ftp://93.184.216.34/v1")).rejects.toMatchObject({
      code: "unsafe_endpoint",
    });
  });
});
