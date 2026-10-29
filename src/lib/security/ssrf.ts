import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
] as const) {
  blocked.addSubnet(network, prefix, "ipv6");
}

function normalizedIp(address: string): { address: string; family: 4 | 6 } | null {
  const family = isIP(address);
  if (family === 4) return { address, family: 4 };
  if (family === 6) {
    const lower = address.toLowerCase();
    if (lower.startsWith("::ffff:")) {
      const mapped = lower.slice("::ffff:".length);
      if (isIP(mapped) === 4) return { address: mapped, family: 4 };
    }
    return { address: lower, family: 6 };
  }
  return null;
}

export function isBlockedAddress(address: string): boolean {
  const normalized = normalizedIp(address);
  if (!normalized) return true;
  return blocked.check(normalized.address, normalized.family === 4 ? "ipv4" : "ipv6");
}

export function isLoopbackAddress(address: string): boolean {
  const normalized = normalizedIp(address);
  if (!normalized) return false;
  return normalized.family === 4
    ? normalized.address.startsWith("127.")
    : normalized.address === "::1";
}

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost");
}

export type EndpointValidationOptions = {
  allowLoopback?: boolean;
  resolver?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
};

export type ValidatedEndpoint = {
  url: URL;
  addresses: Array<{ address: string; family: number }>;
};

export async function validateEndpointUrl(
  rawUrl: string,
  options: EndpointValidationOptions = {},
): Promise<ValidatedEndpoint> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError("Endpoint URL is not a valid absolute URL.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new SsrfError("Endpoint URL must use HTTPS.");
  }
  if (url.username || url.password) {
    throw new SsrfError("Endpoint URL must not contain embedded credentials.");
  }
  if (url.hostname.length === 0) {
    throw new SsrfError("Endpoint URL must include a hostname.");
  }

  const loopbackHost = isLoopbackHostname(url.hostname);
  if (url.protocol === "http:") {
    if (!options.allowLoopback || !loopbackHost) {
      throw new SsrfError(
        "Plain HTTP is only allowed for localhost when ALLOW_INSECURE_LOCAL_ENDPOINTS=true.",
      );
    }
  } else if (url.port && url.port !== "443" && !(options.allowLoopback && loopbackHost)) {
    throw new SsrfError("HTTPS endpoints must use port 443.");
  }

  if (loopbackHost && !options.allowLoopback) {
    throw new SsrfError("Localhost endpoints are disabled. Set ALLOW_INSECURE_LOCAL_ENDPOINTS=true for local development only.");
  }

  const literal = isIP(url.hostname);
  let addresses: Array<{ address: string; family: number }>;
  if (literal) {
    addresses = [{ address: url.hostname, family: literal }];
  } else {
    const resolver =
      options.resolver ??
      ((hostname: string) => dnsLookup(hostname, { all: true, verbatim: true }));
    try {
      addresses = await resolver(url.hostname);
    } catch {
      throw new SsrfError("Endpoint hostname could not be resolved.");
    }
  }
  if (addresses.length === 0) {
    throw new SsrfError("Endpoint hostname did not resolve to any address.");
  }

  for (const entry of addresses) {
    if (options.allowLoopback && isLoopbackAddress(entry.address)) continue;
    if (isBlockedAddress(entry.address)) {
      throw new SsrfError(
        "Endpoint resolves to a private, loopback, link-local, or reserved address. This is blocked to prevent SSRF.",
      );
    }
  }

  return { url, addresses };
}

let strictDispatcher: Agent | null = null;
let loopbackDispatcher: Agent | null = null;

export type SafeLookupResolver = (
  hostname: string,
  options: { all: true; verbatim: true; family?: number },
) => Promise<Array<{ address: string; family: number }>>;

export function createSafeLookup(
  allowLoopback: boolean,
  resolver: SafeLookupResolver = (hostname, options) => dnsLookup(hostname, options),
) {
  return (
    hostname: string,
    options: { family?: number; all?: boolean },
    callback: (
      err: Error | null,
      address?: string | Array<{ address: string; family: number }>,
      family?: number,
    ) => void,
  ) => {
    resolver(hostname, { all: true, verbatim: true, family: options.family })
      .then((addresses) => {
        const usable = addresses.filter((entry) =>
          allowLoopback && isLoopbackAddress(entry.address)
            ? true
            : !isBlockedAddress(entry.address),
        );
        if (usable.length === 0) {
          callback(
            new SsrfError("Blocked connection to a private or reserved address (SSRF protection)."),
          );
          return;
        }
        // Node's net autoSelectFamily path requests all addresses and expects
        // the array form. Returning a single address there produces
        // "Invalid IP address: undefined" and breaks every provider call.
        if (options.all) {
          callback(null, usable);
          return;
        }
        const first = usable[0]!;
        callback(null, first.address, first.family);
      })
      .catch(() => callback(new SsrfError("Custom endpoint hostname could not be resolved.")));
  };
}

/**
 * Dispatcher whose DNS lookup rejects private/reserved IPs at connection time,
 * which also covers DNS rebinding between validation and the request.
 */
export function getSafeDispatcher(allowLoopback: boolean): Agent {
  if (allowLoopback) {
    loopbackDispatcher ??= new Agent({
      connect: { lookup: createSafeLookup(true) as never },
    });
    return loopbackDispatcher;
  }
  strictDispatcher ??= new Agent({
    connect: { lookup: createSafeLookup(false) as never },
  });
  return strictDispatcher;
}

export async function safeFetch(
  rawUrl: string,
  init: RequestInit & { timeoutMs?: number },
  allowLoopback: boolean,
): Promise<Response> {
  await validateEndpointUrl(rawUrl, { allowLoopback });
  const { timeoutMs = 60_000, signal, ...rest } = init;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return undiciFetch(rawUrl, {
    ...rest,
    redirect: "manual",
    signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
    dispatcher: getSafeDispatcher(allowLoopback),
  } as never) as unknown as Promise<Response>;
}
