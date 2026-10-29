import { NextResponse } from "next/server";
import {
  ApiError,
  assertSameOrigin,
  enforceRateLimit,
  jsonError,
  readJson,
  requireApiUser,
} from "@/lib/http/api";
import { deleteUser, findUserById } from "@/lib/db/users";
import { verifyPassword } from "@/lib/auth/password";
import { destroyCurrentSession, clearAnonymousSessionCookie } from "@/lib/auth/session";
import { listImagePaths } from "@/lib/db/runs";
import { deleteStoredImage } from "@/lib/images/storage";
import { deleteAccountSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireApiUser();
    if (user.isAnonymous) {
      throw new ApiError(
        403,
        "account_required",
        "Public sessions do not have a password-protected account. Nothing was deleted.",
      );
    }
    enforceRateLimit(`account-delete:${user.id}`, 3, 10 * 60_000);
    const body = deleteAccountSchema.parse(await readJson(request));
    const row = findUserById(user.id);
    if (!row || !(await verifyPassword(body.password, row.password_hash))) {
      throw new ApiError(401, "invalid_credentials", "Password is incorrect.");
    }
    const images = listImagePaths(user.id);
    deleteUser(user.id);
    await destroyCurrentSession();
    await clearAnonymousSessionCookie();
    await Promise.all(images.map((imagePath) => deleteStoredImage(imagePath)));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
