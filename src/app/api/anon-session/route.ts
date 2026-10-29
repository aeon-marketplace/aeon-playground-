import { NextResponse } from "next/server";
import {
  createAnonymousSession,
  getAnonymousUserId,
} from "@/lib/auth/session";
import { assertSameOrigin, enforceRateLimit, getClientIp, jsonError } from "@/lib/http/api";

export const runtime = "nodejs";

/**
 * Ensure the browser has an anonymous visitor session. This endpoint is
 * idempotent: it never replaces an existing session, because doing so would
 * orphan keys and custom endpoints saved under the current one.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    enforceRateLimit(`anon-session:${getClientIp(request)}`, 30, 60_000);
    const existing = await getAnonymousUserId();
    if (!existing) {
      await createAnonymousSession();
    }
    return NextResponse.json({ ok: true, created: !existing });
  } catch (error) {
    return jsonError(error);
  }
}
