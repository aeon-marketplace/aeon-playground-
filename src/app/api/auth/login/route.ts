import { NextResponse } from "next/server";
import { authenticate } from "@/lib/db/users";
import { createSession, setSessionCookie, clearAnonymousSessionCookie } from "@/lib/auth/session";
import {
  ApiError,
  assertSameOrigin,
  enforceRateLimit,
  getClientIp,
  jsonError,
  readJson,
} from "@/lib/http/api";
import { loginSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const ip = getClientIp(request);
    enforceRateLimit(`login-ip:${ip}`, 20, 10 * 60_000);
    const body = loginSchema.parse(await readJson(request));
    enforceRateLimit(`login-email:${body.email.toLowerCase()}`, 10, 10 * 60_000);
    const user = await authenticate(body.email, body.password);
    if (!user) {
      throw new ApiError(401, "invalid_credentials", "Invalid email or password.");
    }
    enforceRateLimit(`login-account:${user.id}`, 20, 10 * 60_000);
    const token = await createSession(user.id);
    await setSessionCookie(token);
    await clearAnonymousSessionCookie();
    return NextResponse.json({ user });
  } catch (error) {
    return jsonError(error);
  }
}
