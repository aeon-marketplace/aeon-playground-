import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Opt-in framing policy. With no EMBED_ALLOWED_ORIGINS the app keeps its
 * default deny-all posture. Set a comma-separated list of exact origins
 * (for example https://www.example.com) to allow those sites to embed it.
 * Use "*" only when you intentionally allow any site to frame the app.
 */
function frameAncestors(): string {
  const raw = (process.env.EMBED_ALLOWED_ORIGINS ?? "").trim();
  if (!raw) return "frame-ancestors 'none'";

  const entries = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (entries.includes("*")) return "frame-ancestors *";

  const origins = new Set<string>();
  for (const entry of entries) {
    try {
      const url = new URL(entry);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      if (url.username || url.password) continue;
      origins.add(url.origin);
    } catch {
      // Ignore malformed entries rather than widening the policy.
    }
  }

  return origins.size > 0
    ? `frame-ancestors 'self' ${Array.from(origins).join(" ")}`
    : "frame-ancestors 'none'";
}

const ancestors = frameAncestors();
const allowsFraming = ancestors !== "frame-ancestors 'none'";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  // X-Frame-Options cannot express an allowlist, so it is omitted whenever
  // frame-ancestors is configured. CSP remains the authoritative control.
  ...(allowsFraming ? [] : [{ key: "X-Frame-Options", value: "DENY" }]),
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      ancestors,
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["undici"],
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
