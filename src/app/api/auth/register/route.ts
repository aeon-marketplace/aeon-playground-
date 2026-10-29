import { NextResponse } from "next/server";
import { createUser } from "@/lib/db/users";
import { createSession, setSessionCookie, clearAnonymousSessionCookie } from "@/lib/auth/session";
import { getEnv } from "@/lib/env";
import {
  ApiError,
  assertSameOrigin,
  enforceRateLimit,
  getClientIp,
  jsonError,
  readJson,
} from "@/lib/http/api";
import { registerSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    enforceRateLimit(`register:${getClientIp(request)}`, 5, 10 * 60_000);
    const env = getEnv();
    if (!env.allowRegistration) {
      throw new ApiError(
        403,
        "registration_disabled",
        "Registration is disabled on this deployment.",
      );
    }
    const body = registerSchema.parse(await readJson(request));
    let user;
    try {
      user = await createUser(body.email, body.password);
    } catch (error) {
      if (error instanceof Error && /already exists/i.test(error.message)) {
        throw new ApiError(409, "email_taken", "An account with that email already exists.");
      }
      throw error;
    }
    const token = await createSession(user.id);
    await setSessionCookie(token);
    await clearAnonymousSessionCookie();
    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
