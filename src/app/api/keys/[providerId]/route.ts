import { NextResponse } from "next/server";
import { assertSameOrigin, jsonError } from "@/lib/http/api";
import { getAnonymousUserId, getCurrentUser } from "@/lib/auth/session";
import { deleteProviderCredential, listProviderCredentials } from "@/lib/db/credentials";
import { clearModelTestResults } from "@/lib/db/model-tests";
import { getProvider } from "@/lib/providers/registry";

export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ providerId: string }> },
) {
  try {
    assertSameOrigin(request);
    const user = await getCurrentUser();
    const userId = user?.id ?? (await getAnonymousUserId());
    const { providerId } = await context.params;
    const provider = getProvider(providerId);
    if (!provider) {
      return NextResponse.json(
        { error: { code: "unknown_provider", message: "Unknown provider." } },
        { status: 404 },
      );
    }
    if (!userId) {
      return NextResponse.json(
        { error: { code: "key_missing", message: "No saved key for this provider." } },
        { status: 404 },
      );
    }
    await deleteProviderCredential(userId, providerId);
    await clearModelTestResults(userId, providerId);
    return NextResponse.json({ ok: true, credentials: await listProviderCredentials(userId) });
  } catch (error) {
    return jsonError(error);
  }
}
