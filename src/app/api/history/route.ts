import { NextResponse } from "next/server";
import {
  assertSameOrigin,
  enforceRateLimit,
  jsonError,
  requireApiUser,
} from "@/lib/http/api";
import { clearHistory, countRuns, listImagePaths, listRuns } from "@/lib/db/runs";
import { deleteStoredImage } from "@/lib/images/storage";
import { historyQuerySchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const url = new URL(request.url);
    const parsed = historyQuerySchema.parse({
      limit: url.searchParams.get("limit") ?? undefined,
    });
    return NextResponse.json({
      runs: await listRuns(user.id, parsed.limit),
      total: await countRuns(user.id),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireApiUser();
    enforceRateLimit(`history-clear:${user.id}`, 5, 60_000);
    const imagePaths = await listImagePaths(user.id);
    const deleted = await clearHistory(user.id);
    await Promise.all(imagePaths.map((imagePath) => deleteStoredImage(imagePath)));
    return NextResponse.json({ ok: true, deleted });
  } catch (error) {
    return jsonError(error);
  }
}
