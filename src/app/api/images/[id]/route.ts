import { getRun } from "@/lib/db/runs";
import { getCurrentUser } from "@/lib/auth/session";
import { readStoredImage } from "@/lib/images/storage";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json(
      { error: { code: "unauthenticated", message: "Sign in to view this image." } },
      { status: 401 },
    );
  }
  const { id } = await context.params;
  const run = getRun(user.id, id);
  if (!run || run.kind !== "image" || !run.imagePath) {
    return Response.json(
      { error: { code: "not_found", message: "Image not found." } },
      { status: 404 },
    );
  }
  const stored = await readStoredImage(run.imagePath);
  if (!stored) {
    return Response.json(
      { error: { code: "not_found", message: "Image file not found." } },
      { status: 404 },
    );
  }
  return new Response(stored.bytes as unknown as BodyInit, {
    headers: {
      "content-type": stored.contentType,
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
      "content-disposition": "inline",
    },
  });
}
