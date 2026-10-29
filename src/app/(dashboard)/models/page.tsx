import Link from "next/link";
import { KeyRound, Plug, SlidersHorizontal } from "lucide-react";
import CatalogClient from "@/components/catalog/catalog-client";
import { PageHeader } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { filterDefaultCatalogModels } from "@/lib/providers/catalog-view";
import type { PlaygroundId } from "@/lib/providers/playground-support";
import { PROVIDERS } from "@/lib/providers/registry";
import { getRuntimeCatalog } from "@/lib/providers/runtime";

export const metadata = { title: "Model Catalog" };
export const dynamic = "force-dynamic";

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default async function ModelCatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ playground?: string | string[]; view?: string | string[] }>;
}) {
  const params = await searchParams;
  const defaultPlayground: PlaygroundId =
    firstParam(params.playground) === "image" ? "image" : "text";
  const advanced = firstParam(params.view) === "all";
  const user = await getCurrentUser();

  // The default view is restricted to verified FREE and LIMITED FREE routes.
  // Every retained record remains reachable through the advanced view and its
  // own detail route; filtering never deletes data.
  const runtimeCatalog = await getRuntimeCatalog(user?.id ?? null);
const catalog = advanced ? runtimeCatalog : filterDefaultCatalogModels(runtimeCatalog);
  const providerOptions = PROVIDERS.map((provider) => ({
    id: provider.id,
    name: provider.name,
  }));
  const viewHref = (view: "default" | "all") =>
    `/models?playground=${defaultPlayground}${view === "all" ? "&view=all" : ""}`;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="All providers"
        title="Model Catalog"
        description={
          advanced
            ? "Advanced view: every retained or discovered record, including paid-only, user-key-required, unverified, unsupported, deprecated, and confirmed-unavailable routes. Availability and lifecycle are never hidden here."
            : "Browse models with verified FREE or LIMITED FREE inference for a configured provider. Paid-only, unverified, unsupported, and unavailable records stay in the registry and the advanced view. A provider appears only when it has qualifying models for this session."
        }
        actions={
          <>
            <Link
              href={viewHref(advanced ? "default" : "all")}
              className="btn btn-secondary"
            >
              <SlidersHorizontal className="h-4 w-4" />
              {advanced ? "Default view" : "Advanced view"}
            </Link>
            <Link href="/api-keys" className="btn btn-secondary">
              <KeyRound className="h-4 w-4" />
              API keys
            </Link>
            <Link href="/my-models" className="btn btn-secondary">
              <Plug className="h-4 w-4" />
              Custom models
            </Link>
          </>
        }
      />

      <CatalogClient
        models={catalog}
        providers={providerOptions}
        defaultPlayground={defaultPlayground}
        advanced={advanced}
      />
    </div>
  );
}
