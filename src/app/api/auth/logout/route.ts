import { NextResponse } from "next/server";
import { destroyCurrentSession } from "@/lib/auth/session";
import { assertSameOrigin, jsonError } from "@/lib/http/api";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await destroyCurrentSession();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
