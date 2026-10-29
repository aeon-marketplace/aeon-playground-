import { redirect } from "next/navigation";

export const metadata = { title: "Playground" };
export const dynamic = "force-dynamic";

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** Backwards-compatible route for links created before the unified playground. */
export default async function LegacyImagePlaygroundPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string | string[] }>;
}) {
  const params = await searchParams;
  const ref = firstParam(params.ref);
  redirect(`/playground?task=image${ref ? `&ref=${encodeURIComponent(ref)}` : ""}`);
}
