import { NextResponse } from "next/server";
import { assertSameOrigin, enforceRateLimit, jsonError, requireApiUser } from "@/lib/http/api";
import { deleteRun } from "@/lib/db/runs";
import { deleteStoredImage } from "@/lib/images/storage";

export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const user = await requireApiUser();
    enforceRateLimit(`history-delete:${user.id}`, 30, 60_000);
    const { id } = await context.params;
    const result = await deleteRun(user.id, id);
    if (!result.deleted) {
      return NextResponse.json(
        { error: { code: "not_found", message: "Test run not found." } },
        { status: 404 },
      );
    }
    if (result.imagePath) {
      await deleteStoredImage(result.imagePath);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
