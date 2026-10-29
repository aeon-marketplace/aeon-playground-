import { NextResponse } from "next/server";
import {
  ApiError,
  assertSameOrigin,
  enforceRateLimit,
  jsonError,
  readJson,
  requireApiUser,
} from "@/lib/http/api";
import { changePassword } from "@/lib/db/users";
import { createSession, setSessionCookie } from "@/lib/auth/session";
import { changePasswordSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireApiUser();
    if (user.isAnonymous) {
      throw new ApiError(
        403,
        "account_required",
        "Public sessions do not have a password. Create an account to use this.",
      );
    }
    enforceRateLimit(`password:${user.id}`, 5, 10 * 60_000);
    const body = changePasswordSchema.parse(await readJson(request));
    const ok = await changePassword(user.id, body.currentPassword, body.newPassword);
    if (!ok) {
      throw new ApiError(401, "invalid_credentials", "Current password is incorrect.");
    }
    const token = await createSession(user.id);
    await setSessionCookie(token);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
